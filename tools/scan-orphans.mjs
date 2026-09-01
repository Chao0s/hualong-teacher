/**
 * 严格的孤儿样式扫描，补 `npm test` 第 4 步的盲点。
 *
 * `tools/verify-miniprogram.js` 第 118–121 行有一条豁免：WXML 里只要出现一处
 * `class="a {{cond ? 'x' : ''}}"`，**整个文件跳过孤儿规则检查**。所以它报
 * 「未被引用的规则 0 条」并不代表真的没有 —— 本轮已经手工清过两批（case-detail
 * 的 126 行 Word 详案样式、resource-library 的 7 个走不到的图标）。
 *
 * 这个脚本换一条口径：**看类名字串有没有在任何一份 wxml 里出现过**。
 * 它对动态拼接（`banner--{{tone}}`）会误报，所以输出分两栏 —— 完全没出现的是
 * 「确定孤儿」，只以前缀形式出现的是「动态拼接，需人工确认取值域」。
 *
 * 与 git HEAD 比对，只报**本次改动新造成的**，既有的不刷屏。
 *
 *   node tools/scan-orphans.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const MP = 'miniprogram';

/** 收集所有 wxss 里定义的类名，连同它定义在哪个文件。 */
function definitions(read) {
  const out = new Map();
  const files = [];
  for (const f of readdirSync(resolve(REPO, MP, 'styles'))) {
    if (f.endsWith('.wxss')) files.push(`${MP}/styles/${f}`);
  }
  for (const p of readdirSync(resolve(REPO, MP, 'pages'))) {
    files.push(`${MP}/pages/${p}/index.wxss`);
  }
  for (const f of files) {
    let text;
    try { text = read(f); } catch { continue; }
    for (const m of text.matchAll(/^\.([A-Za-z0-9_-]+)/gm)) {
      if (!out.has(m[1])) out.set(m[1], f);
    }
  }
  return out;
}

/** 所有 wxml 拼成一份，用来判断某个类名有没有被提到过。 */
function markup(read) {
  let all = '';
  for (const p of readdirSync(resolve(REPO, MP, 'pages'))) {
    try { all += read(`${MP}/pages/${p}/index.wxml`); } catch { /* 有的目录没有 */ }
  }
  for (const c of readdirSync(resolve(REPO, MP, 'components'))) {
    try { all += read(`${MP}/components/${c}/index.wxml`); } catch { /* 同上 */ }
  }
  return all;
}

function orphans(read) {
  const defs = definitions(read);
  const wxml = markup(read);
  const dead = [];
  const dynamic = [];
  for (const [cls, file] of defs) {
    if (wxml.includes(cls)) continue;
    // `entry__icon--silk` 这种：整名没出现，但前缀出现过，多半是 `--{{expr}}` 拼的
    const stem = cls.replace(/--[A-Za-z0-9_-]+$/, '');
    (stem !== cls && wxml.includes(stem) ? dynamic : dead).push(`${cls}  (${file})`);
  }
  return { dead, dynamic };
}

const now = orphans((f) => readFileSync(resolve(REPO, f), 'utf8'));
let head = { dead: [], dynamic: [] };
try {
  head = orphans((f) => execSync(`git show HEAD:${f}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 1e8 }));
} catch {
  console.log('（读不到 HEAD 版本，只报当前状态）');
}

const fresh = now.dead.filter((x) => !head.dead.includes(x));
const freshDyn = now.dynamic.filter((x) => !head.dynamic.includes(x));

console.log(`当前：确定孤儿 ${now.dead.length} 条，动态拼接待确认 ${now.dynamic.length} 条`);
console.log(`HEAD：确定孤儿 ${head.dead.length} 条，动态拼接待确认 ${head.dynamic.length} 条`);

if (fresh.length) {
  console.log('\n本次新造成的确定孤儿：');
  fresh.forEach((x) => console.log(`  - ${x}`));
}
if (freshDyn.length) {
  console.log('\n本次新增的动态拼接类（人工确认取值域真的产得出来）：');
  freshDyn.forEach((x) => console.log(`  - ${x}`));
}
if (!fresh.length && !freshDyn.length) {
  console.log('\n本次没有新造成孤儿。');
}
process.exitCode = fresh.length ? 1 : 0;
