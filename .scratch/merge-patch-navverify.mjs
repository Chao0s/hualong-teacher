// 一次性改写 .scratch/nav-verify.mjs：顶栏那条验的是「四页」，而 /review 已按用户决定删掉
// （并进 /pages，只回 302）。仪器不跟着改，就会拿一条已经不存在的路由去 parseNav 然后崩掉。
// 这一支只改「站点有哪些页」这一件事，CSS / 对照度 / 高度那些断言一个字不动。
import { readFileSync, writeFileSync } from 'node:fs';

const F = '.scratch/nav-verify.mjs';
let t = readFileSync(F, 'utf8');
const sub = (a, b) => {
  const c = t.split(a).length - 1;
  if (c !== 1) throw new Error(`expect 1 got ${c} for ${JSON.stringify(a.slice(0, 60))}`);
  t = t.replace(a, b);
};

// 1) 路线表少一条：/review 不再是「一站」
sub(`  { path: '/pages', title: '按屏幕看' },\n  { path: '/review', title: '检测评审' },\n`,
  `  { path: '/pages', title: '按屏幕看' },\n  // /review 不在这一组里：2026-09-12 它并进了 /pages，只回 302（见下面的 d 段）。\n`);

// 2) 预期目的地少一个
sub(`  '/review': '按结论判',\n`, '');

// 3) 「四页」→「三页」（整档只有这一处说法要改）
const n4 = (t.match(/四页/g) || []).length;
t = t.replace(/四页/g, '三页');

// 4) 补一条：/review 回 302 且指到 /pages
sub(`console.log('');
\n// ── a. 目的地集合相等 ────────────────────────────────────────────────────`,
  `console.log('');

// ── a0. /review 不是一站了：它只回 302，转到 /pages ────────────────────────
console.log('a0. /review 回 302 且 location 指到 /pages');
{
  const res = await fetch(BASE + '/review', { redirect: 'manual' });
  const loc = res.headers.get('location');
  console.log(\`  /review   HTTP \${res.status} · location: \${loc}\`);
  ok(res.status === 302, \`/review 回 302（实测 \${res.status}）\`);
  ok(loc === '/pages', \`/review 的 location 是 /pages（实测 \${loc}）\`);
}
console.log('');

// ── a. 目的地集合相等 ────────────────────────────────────────────────────`);

writeFileSync(F, t, 'utf8');
console.log(`改完：四页→三页 ${n4} 处；路线表与预期表各少一条`);
