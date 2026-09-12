// 一个屏幕现在有三套名字，摆出来看差在哪：
//   ① 我的 screen_title —— 来自各页 index.json 的 navigationBarTitleText（小程序导航栏）
//   ② screens.tsv 的 module 列     —— 后端登记表里的「模块」
//   ③ 原型 screens/<x>.html 里**肉眼可见**的标题（.nav-bar）与 <title>
// 用户裁定：③ 才是权威，因为人要拿它对着原型找。这个脚本只测量，不改任何东西。
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const BACKEND = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';

const tsv = (p) => {
  const L = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const H = L[0].split('\t');
  return L.slice(1).filter(Boolean).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [H[i], v ?? ''])));
};

const screens = tsv(`${BACKEND}/db/spec/screens.tsv`).filter((r) => r.role === 'teacher' && r.surface === 'miniprogram');
const screenOps = tsv(`${BACKEND}/db/spec/screen-operations.tsv`);

// ① 小程序导航栏标题
const mpTitle = (name) => {
  const f = `${REPO}/miniprogram/pages/${name}/index.json`;
  if (!existsSync(f)) return '(缺 index.json)';
  try { return JSON.parse(readFileSync(f, 'utf8')).navigationBarTitleText || '(空)'; } catch { return '(坏 json)'; }
};

// ③ 原型里肉眼可见的标题：.nav-bar 里的文字，退到 <title> 的第一段
const protoVisible = (file) => {
  const f = `${REPO}/${file}`;
  if (!existsSync(f)) return { nav: '(原型文件不在)', title: '' };
  const html = readFileSync(f, 'utf8');
  const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  const nav = html.match(/<div[^>]*class="[^"]*\bnav-bar\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const docTitle = html.match(/<title>([\s\S]*?)<\/title>/i);
  return { nav: nav ? strip(nav[1]) : '(没有 .nav-bar)', title: docTitle ? strip(docTitle[1]) : '' };
};

const rows = [];
for (const r of screens) {
  const name = (/miniprogram\/pages\/([^/]+)\//.exec(r.mp_file || '') || [])[1];
  if (!name) continue;
  const p = protoVisible(r.screen_file);
  rows.push({ name, module: r.module, mp: mpTitle(name), protoNav: p.nav, protoTitle: p.title, file: r.screen_file });
}

console.log('屏名（目录）'.padEnd(30) + '①小程序导航'.padEnd(18) + '②登记表模块'.padEnd(18) + '③原型可见标题');
console.log('-'.repeat(100));
let diffNav = 0;
for (const r of rows) {
  const mismatch = r.mp !== r.protoNav;
  if (mismatch) diffNav++;
  console.log(
    r.name.padEnd(30)
    + String(r.mp).padEnd(18)
    + String(r.module).padEnd(18)
    + String(r.protoNav).slice(0, 28)
    + (mismatch ? '   ← 与①不同' : ''),
  );
}
console.log('-'.repeat(100));
console.log(`共 ${rows.length} 屏；① 与 ③ 不同的 ${diffNav} 屏。`);
