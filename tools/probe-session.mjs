/**
 * 会话恢复与凭证撤销的探针。
 *
 * 两个场景，都是开发者工具里真的会撞上的：
 *
 *   A 死票    客户端的 token 存在 Storage 里跨重启存活，服务端的会话表是进程
 *             内存重启即失效（`server/lib/auth.mjs`：`const SESSIONS = new Map()`）。
 *             于是本地有票、对面不认。期望：request 层就地重签并重放，页面无感。
 *
 *   B 离职    teacher_id 13（罗慧兰，`teacher_status='s2'`，claim 已释放）。
 *             `/dev/session` **照发 token**，下一发请求才回 session_revoked。
 *             期望：干脆利落地抛错，**不得死锁**——登录中途的 401 若去 await
 *             `ensureSession()`，等的就是它自己。
 *
 * B 组带超时：死锁的表现是「永远不返回」，没有超时的话探针会一起挂住，看起来
 * 像跑得慢，而不是像失败。
 *
 *   node tools/probe-session.mjs
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWxStub, scoreboard } from './lib/wx-stub.mjs';

installWxStub();

const HERE = dirname(fileURLToPath(import.meta.url));
const MP = resolve(HERE, '..', 'miniprogram');
const require_ = createRequire(import.meta.url);

const config = require_(resolve(MP, 'config.js'));
const session = require_(resolve(MP, 'utils', 'session.js'));
const auth = require_(resolve(MP, 'utils', 'auth.js'));
const party = require_(resolve(MP, 'services', 'party.js'));

const sb = scoreboard();
const check = sb.check.bind(sb);

/** 超时包装。死锁不会 reject，只会永远挂着 —— 必须自己拆穿它。 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`${label} 超过 ${ms}ms 没有返回（多半是死锁）`)), ms
    ).unref()),
  ]);
}

async function main() {
  /* ── A 死票自动恢复 ───────────────────────────────────────────────────── */
  const dead = 'THIS_TOKEN_WAS_NEVER_ISSUED_BY_THE_SERVER';
  session.setToken(dead);
  check('A 前置：本地存着一张服务端从没发过的票', session.getToken() === dead);

  const page = await withTimeout(party.listStudies({ limit: 100 }), 15000, '死票恢复');
  check('A 拿着死票仍取到数据（request 层重签并重放）',
    page.items.length === 3, `拿到 ${page.items.length} 条`);
  check('A 恢复后本地换成了新票',
    session.getToken() && session.getToken() !== dead, `token 仍是 ${session.getToken()}`);

  /* ── B 离职教师：必须抛错，且必须不死锁 ───────────────────────────────── */
  const realSubject = config.devSubjectId;
  session.clear();
  auth.signOut();
  // 直接改运行时配置，模拟把 config.js 里的 devSubjectId 改成 13。
  config.devSubjectId = 13;

  let raised = null;
  try {
    await withTimeout(auth.ensureSession(), 15000, '离职教师登录');
  } catch (err) {
    raised = err;
  }

  check('B 以离职教师身份登录会抛错，不会静默成功', raised !== null);
  check('B 抛的是 session_revoked，不是超时（没有死锁）',
    raised && raised.code === 'session_revoked',
    raised ? `实际：${raised.code || raised.message}` : '(没抛)');
  check('B 失败后本地没有留下可用会话', !session.getToken(),
    `token 仍是 ${session.getToken()}`);

  // 还原，免得影响同进程内后续的断言
  config.devSubjectId = realSubject;
  session.clear();

  /* ── C 还原后仍能正常登录 ─────────────────────────────────────────────── */
  const ctx = await withTimeout(auth.ensureSession(), 15000, '还原后登录');
  check('C 换回在职教师后照常登录', ctx.role === 'teacher', `role=${ctx.role}`);
  check('C 会话带着正确的主体', ctx.subject.teacher_id === realSubject,
    `teacher_id=${ctx.subject.teacher_id}`);
}

main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  .then(() => sb.report());
