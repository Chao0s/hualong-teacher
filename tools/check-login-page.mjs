// 登录页的行为检查：把**未经修改**的 miniprogram/pages/login/index.js 装进 vm，
// 只桩掉 `wx` 与它 require 的那两支 utils，驱动它的三条出口。
//
//   node tools/check-login-page.mjs
//
// 为什么不是 probe-*.mjs：那一族是**对着真服务端**跑 HTTP 的；这一支不联网，
// 它验的是**页面自己的分支**（已登录不重发登录、409 才亮手机号按钮、503 走安全阻断文案、
// 拿到令牌也不假装验证成功）。两者不能混名，否则读的人会以为它验了后端。
//
// 它起先是一份写在 %TEMP% 里的一次性夹具。搬进仓库的理由：**团队重跑不到的东西不算验证**。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// 从脚本自己的位置推，别写死盘符 —— 这个工程搬过一次家，而且同事的克隆不在同一个盘。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'miniprogram', 'pages', 'login', 'index.js');
const WXML = join(ROOT, 'miniprogram', 'pages', 'login', 'index.wxml');
const JSON_ = join(ROOT, 'miniprogram', 'pages', 'login', 'index.json');
const APP = join(ROOT, 'miniprogram', 'app.json');

const src = readFileSync(PAGE, 'utf8');
const wxml = readFileSync(WXML, 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  + ${name}`); }
  else { fail++; console.log(`  x ${name}${detail ? ` — ${detail}` : ''}`); }
};

function boot({ loggedIn = false, signIn }) {
  const calls = [];
  let captured = null;
  const auth = { signIn, bindPhone: () => { throw new Error('bindPhone 不该被调用'); } };
  const session = { isLoggedIn: () => loggedIn };
  const sandbox = {
    Page: (o) => { captured = o; },
    wx: {
      reLaunch: (o) => calls.push(['reLaunch', o.url]),
      showToast: (o) => calls.push(['showToast', o.title]),
      showModal: (o) => calls.push(['showModal', o.content]),
    },
    console, Promise, Date, Math, JSON, Object, Array, Number, String, Boolean, Error, RegExp, setTimeout,
    require: (p) => (p.endsWith('utils/auth') ? auth : p.endsWith('utils/session') ? session : {}),
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox, { filename: PAGE });
  const inst = Object.create(captured);
  inst.data = JSON.parse(JSON.stringify(captured.data));
  inst.setData = function (patch) { Object.assign(this.data, patch); };
  return { inst, calls, auth };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

/* A 已经有活会话 —— 不该再打一次登录 */
{
  let called = 0;
  const { inst, calls } = boot({ loggedIn: true, signIn: async () => { called++; return { status: 'ok' }; } });
  inst.onLoad();
  await tick();
  ok('A 已有会话：直接 reLaunch 到 /pages/home/index', calls.some((c) => c[0] === 'reLaunch' && c[1] === '/pages/home/index'), JSON.stringify(calls));
  ok('A 已有会话：没有再发一次登录', called === 0, `signIn 被调了 ${called} 次`);
  ok('A 已有会话：loading 仍是 true（页面正在离开，不重画）', inst.data.loading === true);
}

/* B 409 identity_binding_required —— 亮出手机号按钮 */
{
  const { inst, calls } = boot({ signIn: async () => ({ status: 'needs_phone', jsCode: 'JS-CODE-1' }) });
  inst.onLoad();
  await tick();
  ok('B 409：needsPhone 为真（按钮才出现）', inst.data.needsPhone === true, JSON.stringify(inst.data));
  ok('B 409：loading 关掉、没有 failed 文案', inst.data.loading === false && inst.data.failed === '');
  ok('B 409：js_code 留在实例上给 stage 2 复用（不重新 wx.login）', inst.jsCode === 'JS-CODE-1', String(inst.jsCode));
  ok('B 409：没有跳页', !calls.some((c) => c[0] === 'reLaunch'));
  ok('B wxml：那颗按钮是 <button open-type="getRealtimePhoneNumber">，且不在别处出现',
    (wxml.match(/open-type="getRealtimePhoneNumber"/g) || []).length === 1
    && /wx:elif="\{\{needsPhone\}\}"/.test(wxml));
  ok('B wxml：没有用已废弃的 getPhoneNumber（A2）', !/open-type="getPhoneNumber"/.test(wxml));
  ok('B wxml：按钮带 bindgetphonenumber', /bindgetphonenumber="onGetPhoneNumber"/.test(wxml));
}

/* C 200 -> 跳首页 */
{
  const { inst, calls } = boot({ signIn: async () => ({ status: 'ok', context: { role: 'teacher' } }) });
  inst.onLoad();
  await tick();
  ok('C 已登录：reLaunch 到 /pages/home/index', calls.some((c) => c[0] === 'reLaunch' && c[1] === '/pages/home/index'), JSON.stringify(calls));
  ok('C 没有亮出手机号按钮', inst.data.needsPhone === false);
}

/* D 503 wechat_phone_quota_exhausted —— 安全阻断文案 */
{
  const err = Object.assign(new Error('手机号验证配额已用尽'), {
    code: 'wechat_phone_quota_exhausted', statusCode: 503,
    userMessage: '手机号验证暂时不可用，请稍后重试或联系园方',
  });
  const { inst } = boot({ signIn: async () => { throw err; } });
  inst.onLoad();
  await tick();
  ok('D 503：主文案取 err.userMessage（页面不自己译错误码）', inst.data.failed === err.userMessage, inst.data.failed);
  ok('D 503：quotaStop 为真，附上 F17 那句说明', inst.data.quotaStop === true);
  ok('D F17 原话四条侧门都点了名：短信／邀请码／人工绑定／密码后门',
    /短信/.test(inst.data.quotaStopNote) && /邀请码/.test(inst.data.quotaStopNote)
    && /人工绑定/.test(inst.data.quotaStopNote) && /密码后门/.test(inst.data.quotaStopNote));
  ok('D 失败页给得出重试入口', /bindtap="onRetry"/.test(wxml));
  inst.onRetry();
  await tick();
  ok('D 重试会重跑 signIn（loading 回来过）', inst.data.loading === false);
}

/* E 403 identity_not_on_roster —— 不是 F17 那一支，不给那段说明 */
{
  const err = Object.assign(new Error('x'), { code: 'identity_not_on_roster', statusCode: 403, userMessage: '该手机号不在园所名册内，请联系园方' });
  const { inst } = boot({ signIn: async () => { throw err; } });
  inst.onLoad();
  await tick();
  ok('E 403：照实显示名册外的解释', inst.data.failed === err.userMessage);
  ok('E 403：quotaStop 为假（不把普通失败说成安全阻断）', inst.data.quotaStop === false);
}

/* F 手机号那一步：今天留空，且不假装成功 */
{
  let bound = 0;
  const { inst, calls, auth } = boot({ signIn: async () => ({ status: 'needs_phone', jsCode: 'JS-CODE-2' }) });
  auth.bindPhone = () => { bound++; return Promise.resolve({ status: 'ok' }); };
  inst.onLoad();
  await tick();
  inst.onGetPhoneNumber({ detail: { code: 'PHONE-CODE-1' } });
  ok('F 拿到动态令牌也不调 bindPhone（G1 没落地，不假装成功）', bound === 0);
  ok('F 没有跳首页（点了不会「登录成功」）', !calls.some((c) => c[0] === 'reLaunch'), JSON.stringify(calls));
  ok('F 给了一句诚实的说明，且点了名等的是 G1', calls.some((c) => c[0] === 'showModal' && /G1/.test(c[1])), JSON.stringify(calls));
  const before = calls.length;
  inst.onGetPhoneNumber({ detail: {} });
  ok('F 没拿到凭证时说没拿到，不说成功', calls.length === before + 1 && calls[calls.length - 1][0] === 'showToast');
  // 只看代码，不看注释 —— 头注里正写着「不 require utils/request」「不用 switchTab」这两句。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  ok('F 代码里不 require utils/request（唯一的 HTTP 出口）', !/utils\/request/.test(code));
  ok('F 代码里 require 的只有 utils/auth 与 utils/session',
    JSON.stringify([...code.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])) === JSON.stringify(['../../utils/auth', '../../utils/session']),
    JSON.stringify([...code.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])));
  ok('F 代码里不拼 URL（没有 /api/ 或 http:// 字面量）', !/https?:\/\/|\/api\/v1/.test(code));
}

/* G 三件事都登记了 */
{
  const app = JSON.parse(readFileSync(APP, 'utf8'));
  const json = JSON.parse(readFileSync(JSON_, 'utf8'));
  ok('G app.json 注册了 pages/login/index', app.pages.includes('pages/login/index'));
  ok('G app.json 没有 tabBar 键 —— 所以不能 switchTab，只能用 reLaunch', !('tabBar' in app));
  ok('G index.json 写了 navigationBarTitleText', typeof json.navigationBarTitleText === 'string' && json.navigationBarTitleText.length > 0, JSON.stringify(json));
  ok('G 代码里没有 wx.switchTab（非 tab 页会静默失败）', !/wx\.switchTab/.test(readFileSync(PAGE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
}

// ── H. guard 的接线（2026-09-12 用户裁定：接上，并把 login 改成启动页）──────────
// 这一组钉的是「会话失效真的会把教师送到登录页」，以及**不会自己跳自己**。
{
  const guardSrc = readFileSync(join(ROOT, 'miniprogram', 'utils', 'guard.js'), 'utf8');
  const code = readFileSync(PAGE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // G 那个块里的 `app` 是块级声明，这里看不见 —— 自己读一次，别去动上游。
  const appJson = JSON.parse(readFileSync(APP, 'utf8'));

  ok('H app.json 的第一项是登录页（启动页）', appJson.pages[0] === 'pages/login/index', appJson.pages[0]);
  ok('H app.json 仍注册着首页（登录后要跳它）', appJson.pages.includes('pages/home/index'));
  ok('H guard 的 endSessionOnAuthFailure 里有 wx.reLaunch',
    /endSessionOnAuthFailure[\s\S]{0,400}wx\.reLaunch/.test(guardSrc));
  ok('H guard 跳的是登录页',
    /wx\.reLaunch\(\{\s*url:\s*'\/pages\/login\/index'\s*\}\)/.test(guardSrc));
  // 返回 true 才叫「已经处理掉了、别再渲染」。恒 false 的那一版会让每个页面 401 后留白页。
  ok('H guard 跳转之后 return true（否则页面会继续渲染一张空页）',
    /wx\.reLaunch\([^)]*\)[\s\S]{0,120}return true/.test(guardSrc));
  // 防循环：登录页自己不调 guard，否则登录失败 → reLaunch 到登录页 → 再失败…
  ok('H 登录页不调 guard.endSessionOnAuthFailure（不会自己跳自己）',
    !/endSessionOnAuthFailure|require\(['"][^'"]*guard['"]\)/.test(code));
}

console.log(`\n${pass} 项通过，${fail} 项失败。`);
process.exit(fail ? 1 : 0);
