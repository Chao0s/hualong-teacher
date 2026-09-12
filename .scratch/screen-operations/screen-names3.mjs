// 终账：按「原型里肉眼可见」取页名，按优先级列几个可见容器，并记录**取到了哪一个**。
// 用户裁定：可见文字是权威；class 名、代码里的 label、<title> 元数据都不算。
import { readFileSync, existsSync } from 'node:fs';
const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const BACKEND = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';

const tsv = (p) => {
  const L = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const H = L[0].split('\t');
  return L.slice(1).filter(Boolean).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [H[i], v ?? ''])));
};
const txt = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

// 可见容器的优先级。每个都是**手机框里真能看见**的元素。
const PATTERNS = [
  [/<div[^>]*class="[^"]*\bnav-bar\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i, '.nav-bar'],
  [/<header[^>]*class="[^"]*\bnav\b[^"]*"[^>]*>([\s\S]*?)<\/header>/i, 'header.nav'],
  [/<[^>]*class="[^"]*\bpage-title\b[^"]*"[^>]*>([\s\S]*?)<\//i, '.page-title'],
  [/<[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\//i, '.title'],
];
const NAV_GLYPH = /^[\s‹<←›»·~—\-–|]+/;

const screens = tsv(`${BACKEND}/db/spec/screens.tsv`).filter((r) => r.role === 'teacher' && r.surface === 'miniprogram');
const mpTitle = (n) => {
  const f = `${REPO}/miniprogram/pages/${n}/index.json`;
  if (!existsSync(f)) return '';
  try { return JSON.parse(readFileSync(f, 'utf8')).navigationBarTitleText || ''; } catch { return ''; }
};

const out = [];
for (const r of screens) {
  const n = (/miniprogram\/pages\/([^/]+)\//.exec(r.mp_file || '') || [])[1];
  if (!n) continue;
  const f = `${REPO}/${r.screen_file}`;
  let visible = '', src = '取不到';
  if (existsSync(f)) {
    const html = readFileSync(f, 'utf8');
    for (const [re, label] of PATTERNS) {
      const m = html.match(re);
      if (!m) continue;
      // header.nav 里含返回箭头与可能空 <span/>；去掉箭头再取，取到的第一段非空文字
      const t = txt(m[1]).replace(NAV_GLYPH, '').trim();
      if (t) { visible = t; src = label; break; }
    }
  } else src = '原型文件不在';
  out.push({ n, mp: mpTitle(n), vis: visible, src });
}

const same = out.filter((r) => r.mp === r.vis);
const diff = out.filter((r) => r.vis && r.mp !== r.vis);
const none = out.filter((r) => !r.vis);
console.log(`共 ${out.length} 屏 —— 与原型可见标题相同 ${same.length}；不同 ${diff.length}；取不到 ${none.length}`);
console.log(`来源分布：${Object.entries(out.reduce((a, r) => (a[r.src] = (a[r.src] || 0) + 1, a), {})).map(([k, v]) => `${k} ${v}`).join('  ')}`);
if (diff.length) {
  console.log('\n=== 真不同（要按你的规矩改成原型的可见字）===');
  for (const r of diff) console.log(`  ${r.n.padEnd(30)} 小程序「${r.mp}」  vs  原型可见「${r.vis}」  [${r.src}]`);
}
if (none.length) {
  console.log('\n=== 取不到可见标题 ===');
  for (const r of none) console.log(`  ${r.n.padEnd(30)} 小程序「${r.mp}」  (${r.src})`);
}
