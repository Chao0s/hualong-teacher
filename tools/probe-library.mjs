/**
 * Runs the client's real service layer against the testdata server, outside the
 * simulator.
 *
 * Why this exists: `npm test` is a static check — it cannot tell you whether a
 * path matches the contract or whether a field the page binds is actually on the
 * wire. The simulator can, but only a human clicking. This closes the gap in
 * between: it loads `utils/request.js`, `utils/auth.js` and `services/library.js`
 * unmodified and calls them, so a wrong path or a renamed field fails here.
 *
 * 桩与计分板在 `tools/lib/wx-stub.mjs`，四个探针共用一份。桩住的只有平台 API
 * （存储与网络），其上每一层都是原样加载的发布代码。
 *
 *   node tools/probe-library.mjs
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWxStub, scoreboard } from './lib/wx-stub.mjs';

installWxStub();

const HERE = dirname(fileURLToPath(import.meta.url));
const MP = resolve(HERE, '..', 'miniprogram');

const require_ = createRequire(import.meta.url);
const library = require_(resolve(MP, 'services', 'library.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const has = sb.has.bind(sb);

async function main() {
  const ctx = await guard.requireSession();
  check('登录成功，角色为 teacher', ctx.role === 'teacher', `role=${ctx.role}`);
  check('会话带着当前学期', Boolean(ctx.current_term), 'current_term 为空');

  // ---- resources -----------------------------------------------------------
  const resPage = await library.listResources({ limit: 100 });
  check('资源列表非空', resPage.items.length > 0, `拿到 ${resPage.items.length} 条`);
  // db_resource 共 12 行，教师 1 看得见 11 行。差的那一行是 resource_id=5
  // 「香云纱的秘密」——`resource_status='s1'` 且 `created_by=5`，别人的草稿。
  // 范围断言写成「11 条且不含 5」比写成「12 条」强：它同时钉住了「看得见的」与
  // 「看不见的」，改坏任何一边都会红。
  check('教师 1 看得见 11 条资源（12 行中挡掉别人的草稿 id=5）',
    resPage.items.length === 11, `拿到 ${resPage.items.length} 条`);
  check('别人的草稿 resource_id=5 不可见',
    !resPage.items.some((r) => r.id === 5),
    `列表里出现了 id=5，范围判定漏了`);
  has(resPage.items[0], ['id', 'name', 'tag', 'tagLabel', 'icon', 'tone', 'statusLabel', 'updatedAt'], '资源卡');
  check('资源分页返回 nextCursor 字段', 'nextCursor' in resPage);

  const tags = new Set(resPage.items.map((r) => r.tagLabel));
  check('资源标签已译成中文（衣食住行艺）',
    [...tags].every((t) => '衣食住行艺'.includes(t)), `实际：${[...tags].join(',')}`);

  const icons = new Set(resPage.items.map((r) => r.icon));
  const KNOWN_ICONS = ['silk', 'milk', 'hall', 'boat', 'lion'];
  check('图标全部落在 wxss 已有的类里',
    [...icons].every((i) => KNOWN_ICONS.includes(i)), `实际：${[...icons].join(',')}`);

  // 服务端筛选：契约给了 resource_tag，就不该在客户端过滤
  const g3 = await library.listResources({ tag: '住', limit: 100 });
  check('按标签「住」服务端筛选生效',
    g3.items.length > 0 && g3.items.every((r) => r.tagLabel === '住'),
    `拿到 ${g3.items.length} 条，标签：${g3.items.map((r) => r.tagLabel).join(',')}`);

  const detail = await library.getResource(resPage.items[0].id);
  has(detail, ['id', 'title', 'tags', 'sections'], '资源详情');
  check('资源详情三段正文齐全', detail.sections.length === 3,
    `实际 ${detail.sections.length} 段：${detail.sections.map((s) => s.title).join('/')}`);
  check('资源详情正文非空',
    detail.sections.every((s) => s.text && s.text.length > 0), '有空白段落');

  // ---- cases ---------------------------------------------------------------
  const casePage = await library.listCases({ limit: 100 });
  // 同一条规则：db_case 共 10 行，case_id=6「小小点心师」是 `s1` 草稿且
  // `created_by=4`，教师 1 看不到。
  check('教师 1 看得见 9 条案例（10 行中挡掉别人的草稿 id=6）',
    casePage.items.length === 9, `拿到 ${casePage.items.length} 条`);
  check('别人的草稿 case_id=6 不可见',
    !casePage.items.some((c) => c.id === 6),
    '列表里出现了 id=6，范围判定漏了');
  has(casePage.items[0], ['id', 'name', 'grade', 'field', 'thumb', 'tone', 'pills'], '案例卡');

  const grades = new Set(casePage.items.map((c) => c.grade));
  check('年级已译成中文（小/中/大班）',
    [...grades].every((g) => ['小班', '中班', '大班'].includes(g)), `实际：${[...grades].join(',')}`);
  const fields = new Set(casePage.items.map((c) => c.field));
  check('领域已译成中文（健康/语言/社会/科学/艺术）',
    [...fields].every((f) => ['健康', '语言', '社会', '科学', '艺术'].includes(f)),
    `实际：${[...fields].join(',')}`);

  // 13 个筛选片逐个钉到库里的行，**计数与 id 集合两头都钉**（CLAUDE.md §7.4／§7.6）。
  // 只钉「筛出来的每条都是大班」不够 —— 服务端完全忽略这个参数时，回的是全部 9 条，
  // 而「每条都是大班」在那 9 条里也可能碰巧成立。G84 就是这么漏过去的：原先三条
  // 活动类型断言写的是「多选合并 == 两次单选的并集」，服务端忽略 case_area 时
  // a1=9、a2=9、并集=9、合并=9，恒真。
  //
  // 权威值（教师 1 的可见范围，9 行）：
  //   psql -d hualong_test -c "WITH v AS (SELECT * FROM db_case
  //     WHERE school_id=1 AND (case_status<>'s1' OR created_by=1))
  //     SELECT 'grade',case_grade,count(*) FROM v GROUP BY 2
  //     UNION ALL SELECT 'field',case_field,count(*) FROM v GROUP BY 2
  //     UNION ALL SELECT 'area',a,count(*) FROM v, unnest(case_area) a GROUP BY 2"
  const CHIPS = [
    ['grade', '小班', 3, [5, 9, 10]],
    ['grade', '中班', 2, [2, 7]],
    ['grade', '大班', 4, [1, 3, 4, 8]],
    ['field', '健康', 1, [1]],
    ['field', '语言', 2, [2, 8]],
    ['field', '社会', 2, [4, 10]],
    ['field', '科学', 2, [3, 7]],
    ['field', '艺术', 2, [5, 9]],
    ['area', '集体教学', 5, [1, 2, 3, 4, 9]],
    ['area', '区域', 4, [1, 5, 7, 9]],
    ['area', '主题探究', 3, [2, 5, 8]],
    ['area', '家园社共育', 3, [3, 7, 10]],
    ['area', '数字化', 3, [4, 8, 10]],
  ];
  for (const [kind, label, n, ids] of CHIPS) {
    const arg = kind === 'grade' ? { grade: label } : kind === 'field' ? { field: label } : { areas: [label] };
    const page = await library.listCases({ ...arg, limit: 100 });
    const got = page.items.map((c) => c.id).sort((a, b) => a - b);
    const want = [...ids].sort((a, b) => a - b);
    check(`筛选片「${label}」筛出 ${n} 条，且就是库里那几条`,
      got.length === n && got.join(',') === want.join(','),
      `期望 ${want.join(',')}，实际 ${got.join(',')}`);
  }

  // 多选活动类型 -> 并发多发再合并（契约的 case_area 是单值参数）
  const a1 = await library.listCases({ areas: ['集体教学'], limit: 100 });
  const a2 = await library.listCases({ areas: ['区域'], limit: 100 });
  const both = await library.listCases({ areas: ['集体教学', '区域'], limit: 100 });
  const union = new Set([...a1.items, ...a2.items].map((c) => c.id));
  check('多选合并等于两次单选的并集', both.items.length === union.size,
    `合并 ${both.items.length} 条，并集 ${union.size} 条`);
  // 并集必须严格大于任一单选 —— 否则「合并 == 并集」在服务端忽略参数时是恒真的
  check('两个活动类型的并集严格大于任一单选（钉住恒真陷阱）',
    union.size > a1.items.length && union.size > a2.items.length,
    `a1=${a1.items.length}，a2=${a2.items.length}，并集=${union.size}`);
  check('多选合并结果无重复',
    new Set(both.items.map((c) => c.id)).size === both.items.length,
    '出现了重复的 case_id');
  check('多选合并后不谎报游标', both.nextCursor === null,
    `nextCursor=${both.nextCursor}`);
  // `case_status` 这一格不在这里测：契约声明了它，服务端也已随 G84 一并实作，但
  // 教师端案例库没有状态筛选片，`listCases` 因此不收这个参数（§4.3 不加没人要的选项）。
  // 它的回归测试在服务端那侧，见 db/GAPS.md G84 记的 curl 口径。

  const caseDetail = await library.getCase(casePage.items[0].id);
  has(caseDetail, ['id', 'title', 'grade', 'field', 'areas', 'intro', 'trans'], '案例详情');
  check('案例详情带活动类型', Array.isArray(caseDetail.areas) && caseDetail.areas.length > 0,
    `areas=${JSON.stringify(caseDetail.areas)}`);

  // ---- the contract's own guarantees --------------------------------------
  let rejected = false;
  let actualCode = '';
  try {
    await library.getResource(99999);
  } catch (err) {
    rejected = err.code === 'not_found';
    actualCode = err.code;
  }
  check('范围外的 resource_id 回 not_found（越权读被挡）', rejected,
    actualCode ? `实际 ${actualCode}` : '这一发没被拒');
}

main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  .then(() => sb.report());
