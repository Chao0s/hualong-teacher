/**
 * 校準：`page.wxml()` 讀回來的東西，是全的、被截斷的、還是讀失敗的？
 *
 * 為什麼要問：逐頁對照報「282 個意圖沒畫出來」，但抽驗時發現 `banner-img`
 * **在小程序源碼裡有樣式**（`home/index.wxss`），卻沒出現在讀到的渲染 WXML 裡。
 * 所以在拿那個數字當缺陷之前，先證明「讀到的」等於「畫出來的」。
 *
 * 判據（三種分開講，不合併）：
 *   ① 源碼 wxml 裡有的 class 集合   —— 應該畫出來的（靜態上限）
 *   ② 渲染讀到的 class 集合         —— 實際讀到的
 *   ③ 兩者的差                     —— 若很大，就是**讀取截斷**，不是元素缺失
 */
import { Automator } from '@weapp-vite/miniprogram-automator';
import { readFileSync } from 'node:fs';

const SCREEN = process.argv[2] ?? 'home';
const mp = await new Automator().connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
await mp.reLaunch(`/pages/${SCREEN}/index`);
await new Promise((r) => setTimeout(r, 1800));

const page = await mp.currentPage();
console.log(`  currentPage: ${page?.path ?? '(取不到)'}`);

// ① 源码
const src = readFileSync(`miniprogram/pages/${SCREEN}/index.wxml`, 'utf8');
const srcClasses = new Set();
for (const m of src.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c && !c.includes('{')) srcClasses.add(c);

// ② 渲染读到的
const wxml = String(await page.wxml());
const gotClasses = new Set();
for (const m of wxml.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) gotClasses.add(c);

console.log(`\n  ① 源码 index.wxml      ${String(src.length).padStart(6)} 字   class ${srcClasses.size} 个`);
console.log(`  ② 渲染读回的 wxml      ${String(wxml.length).padStart(6)} 字   class ${gotClasses.size} 个`);

// ③ 差
const missing = [...srcClasses].filter((c) => !gotClasses.has(c) && ![...gotClasses].some((g) => g.startsWith(c)));
console.log(`\n  源码有、渲染读到的没有: ${missing.length} 个`);
if (missing.length) console.log(`    ${missing.slice(0, 14).join(', ')}${missing.length > 14 ? ' …' : ''}`);

// 关键判据：读到的 wxml 是不是一个完整的模板（首尾对不对）
const head = wxml.slice(0, 60).replace(/\s+/g, ' ');
const tail = wxml.slice(-60).replace(/\s+/g, ' ');
console.log(`\n  读回的 wxml 开头: ${head}`);
console.log(`  读回的 wxml 结尾: ${tail}`);
console.log(`  含未被替换的模板占位 \`{{\`: ${(wxml.match(/\{\{/g) ?? []).length} 处`);
console.log(`  截断迹象（结尾不是标签闭合）: ${/<$|\{\{$/.test(wxml) ? '✗ 可能截断' : '✓ 看着完整'}`);

try { mp.disconnect(); } catch { /* 同步 */ }
