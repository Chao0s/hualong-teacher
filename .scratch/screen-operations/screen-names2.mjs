// 干净版：原型可见标题从哪儿取、取到什么、和①差在哪。
//   优先 .nav-bar（剥掉返回箭头 ‹/‹/← 等导航装饰）
//   没有 .nav-bar 时退到 <title>（格式是「<页名> · 幼儿园教师端」，取 · 前那段）
//   两处都没有才算「取不到」
import { readFileSync, existsSync } from 'node:fs';
const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const BACKEND = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';

const tsv = (p) => {
  const L = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const H = L[0].split('\t');
  return L.slice(1).filter(Boolean).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [H[i], v ?? ''])));
};
const strip = (s) => s
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/g, ' ')
  .replace(/^[\s‹<←›»·~—\-–]+/, '')   // 导航装饰
  .replace(/\s+/g, ' ')
  .trim();

const screens = tsv(`${BACKEND}/db/spec/screens.tsv`).filter((r) => r.role === 'teacher' && r.surface === 'miniprogram');
const mpTitle = (n) => {
  const f = `${REPO}/miniprogram/pages/${n}/index.json`;
  if (!existsSync(f)) return '';
  try { return JSON.parse(readFileSync(f, 'utf8')).navigationBarTitleText || ''; } catch { return ''; }
};

const protoTitle = (file) => {
  const f = `${REPO}/${file}`;
  if (!existsSync(f)) return { text: '', src: '文件不在' };
  const html = readFileSync(f, 'utf8');
  const nav = html.match(/<div[^>]*class="[^"]*\bnav-bar\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (nav && strip(nav[1])) return { text: strip(nav[1]), src: '.nav-bar' };
  const t = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (t) return { text: strip(t[1]).split('·')[0].trim(), src: '<title>' };
  return { text: '', src: '取不到' };
};

const rows = [];
for (const r of screens) {
  const n = (/miniprogram\/pages\/([^/]+)\//.exec(r.mp_file || '') || [])[1];
  if (!n) continue;
  const p = protoTitle(r.screen_file);
  rows.push({ n, mp: mpTitle(n), proto: p.text, src: p.src });
}

const same = rows.filter((r) => r.mp === r.proto);
const diff = rows.filter((r) => r.mp !== r.proto && r.proto);
const none = rows.filter((r) => !r.proto);

console.log(`共 ${rows.length} 屏：① 与原型可见标题相同 ${same.length}；不同 ${diff.length}；原型取不到 ${none.length}\n`);
console.log('=== 真不同（这些要按你的规矩改成原型的）===');
for (const r of diff) console.log(`  ${r.n.padEnd(30)} 小程序「${r.mp}」  vs  原型「${r.proto}」  [${r.src}]`);
console.log('\n=== 原型取不到标题的 ===');
for (const r of none) console.log(`  ${r.n.padEnd(30)} 小程序「${r.mp}」  原型来源=${r.src}`);
console.log('\n=== 取标题的来源分布 ===');
const by = {}; for (const r of rows) by[r.src] = (by[r.src] || 0) + 1;
for (const [k, v] of Object.entries(by)) console.log(`  ${k}: ${v}`);
