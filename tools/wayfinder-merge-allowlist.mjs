/**
 * 一次性：把两位审核人的 wiring.allowlist_c1.json / _c2.json 合成 docs/audit/wiring.allowlist.json，
 * 并把每条结论指向对应的 GitHub issue。三处分歧按 2026-09-08 的答复定：
 *   撤回端点 → 不建（F27 已定：教师端无作者撤回；端点删除在 #32）
 *   编册锁定 → 阻于 #17
 *   onPickWord 两处 → 接，合一张 #2
 *
 * **它整份重写 wiring.allowlist.json，不是增量合并。** 已经手工改过或删掉的结论会被
 * 它按 c1／c2 那两份原始答复写回来。所以重跑之前先 `git diff` 看一眼：多出来的行
 * 不是新结论，是被复活的旧结论。这份脚本留着只为了复现 c1／c2 到 allowlist 的合并。
 *
 *   node tools/wayfinder-merge-allowlist.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const c1 = read('docs/audit/wiring.allowlist_c1.json').rules;
const c2 = read('docs/audit/wiring.allowlist_c2.json').rules;
const nums = read('docs/audit/wiring-issues-2026-09-08.numbers.json').tickets;
const N = (id) => `#${nums[id]}`;

/** key 的片段 → 票 id。第一个命中的算。 */
const ROUTE = [
  // submitForReview／downloadLink 已随 #10 拆成四个明确函数，这两个名字不再出现在
  // 扫描结果里。正则留着只为了复现 c1／c2 那两份原始答复的路由，命中不了任何新 key。
  [/submitForReview|downloadLink/, 'L3-lib'],
  // withdrawal 不进路由：F27 已经把它定完了，OVERRIDE 里的结论自带 #32，再追一次 → #14 就是往回指。
  [/PATCH \/library/, 'L4-myuploads'],
  [/teacher-profile\b.*L1|contract:.*teacher-profile/, 'L4-profile'],
  [/compilation\/\{compilation_id\}\/lock/, 'L4-lock'],
  [/growth-book\/(compilation|sections|books|precheck)|growth-book\/books/, 'L4-gb-status'],
  [/contract:.*\/tasks\//, 'L4-tasks'],
  [/scales\//, 'L4-scales'],
  [/term-evaluation|child-assessment|growth-record|contract:GET \/assessments|contract:PUT \/assessments/, 'L4-assess'],
  [/onPickCover|onPickWord|onAddPhoto/, 'L1-media'],
  [/onFileTap|onToast「预览」|onToast「下载」|onDownload|onAction/, 'L1-download'],
  [/onToast「提交材料」/, 'L4-tasks'],
  [/onFilterTap/, 'L1-writes'],
  [/onSave「保存学期评价」/, 'L1-writes'],
  [/onSubmit「提交寄语」/, 'L1-message'],
  [/onPageTap/, 'L1-pagetap'],
  [/feed-more/, 'L2-more'],
  [/case-library:L5/, 'L5-filters'],
  [/L5:原型跳转/, 'L5-nav'],
  [/L5:原型按钮/, 'L5-wording'],
  [/my-training:L6/, 'L6-mytraining'],
  [/growth-book.*:L6/, 'L6-gb-pages'],
  [/(teacher-term|teacher-message|comprehensive-assessment|growth-comprehensive|assessment-tool).*:L6/, 'L6-assess-pages'],
  [/teacher-task-detail:L6|teacher-profile:L6/, 'L6-tsv'],
];
const route = (key) => (ROUTE.find(([re]) => re.test(key.replace(/"/g, ''))) || [])[1];

const merged = new Map();
for (const r of [...c2, ...c1]) { // c1 后写，c1 优先
  const prev = merged.get(r.key) || {};
  merged.set(r.key, { ...prev, ...r, reason: [prev.reason, r.reason].filter(Boolean).join(' ／ ') });
}

const OVERRIDE = {
  withdrawal: { status: '不建', reason: 'F27 已定：教师端无作者撤回；端点删除 → #32' },
  lock: { status: '阻于', reason: '锁定权限（教师 vs 校长）在 #17 讨论' },
};
const out = [];
for (const r of merged.values()) {
  const t = route(r.key);
  let { status, reason } = r;
  if (/withdrawal/.test(r.key)) ({ status, reason } = OVERRIDE.withdrawal);
  else if (/compilation_id\}\/lock/.test(r.key)) ({ status, reason } = OVERRIDE.lock);
  else if (/onFilterTap/.test(r.key)) { status = '误报'; reason = '纯本地筛选切换；「开发中」字样来自同页别的方法'; }
  else if (/onPickWord/.test(r.key)) reason = '第 115／205 行同一 handler（资源／案例表单块）';
  // 长段重复的部署认知说明不逐条留，收进 #24
  if (/TSV 的部分/.test(reason)) reason = '审核人对 screens.tsv 的理解见 #24';
  if (t) reason = `${reason ? `${reason}；` : ''}→ ${N(t)}`;
  out.push({ key: r.key, status, reason: reason.trim(), author: r.author || 'Lin', updated_at: r.updated_at });
}
out.sort((a, b) => a.key.localeCompare(b.key, 'zh'));
writeFileSync('docs/audit/wiring.allowlist.json', JSON.stringify({ rules: out }, null, 2) + '\n');
const byStatus = out.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
console.log(`合并 ${out.length} 条（c1 ${c1.length}，c2 ${c2.length}，去重后）；按结论：${JSON.stringify(byStatus)}；未指到票的 ${out.filter((r) => !/#\d+/.test(r.reason)).length} 条`);
for (const r of out.filter((x) => !/#\d+/.test(x.reason))) console.log('  未指到票：', r.key);
