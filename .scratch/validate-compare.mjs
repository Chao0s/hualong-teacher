/**
 * 驗「逐頁對照」的量法對不對 —— 拿 home 一屏為例。
 *
 * 疑點：55 屏 578 個意圖裡有 297 個「沒畫出來」（51%），太高，不像真漂移。
 * 可能是 `page.wxml()` 回的**不是**渲染後的 class，而是帶 `{{}}` 綁定的模板。
 *
 * 判據：把渲染結果裡實際出現的 class 全部列出來，與原型意圖的名字對照。
 * 若渲染結果裡有 `banner__title`（早前 `render-pages.mjs` 真的抓到過它），
 * 那就說明 class 是可讀的，問題在別處。
 */
import { Automator } from '@weapp-vite/miniprogram-automator';
import { intentsOf } from '../tools/lib/intent-join.mjs';

const mp = await new Automator().connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
await mp.reLaunch('/pages/home/index');
await new Promise((r) => setTimeout(r, 1500));

const page = await mp.currentPage();
console.log(`  currentPage: ${page?.path ?? '(取不到)'}`);

const wxml = String(await page.wxml());
console.log(`  wxml 长度: ${wxml.length}`);

const classes = new Set();
for (const m of wxml.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
console.log(`  抽到 ${classes.size} 个 class`);

const intents = intentsOf('screens/home.html');
const names = intents.map((i) => (i.id.includes('.') ? i.id.slice(i.id.indexOf('.') + 1) : i.id));
console.log(`  原型意圖 ${intents.length} 个`);
console.log(`\n  渲染结果里实际有的 class（前 30 个）:`);
console.log(`    ${[...classes].slice(0, 30).join(', ')}`);
console.log(`\n  原型意圖要的那几个名字，在不在裡面:`);
for (const n of names.slice(0, 16)) console.log(`    ${classes.has(n) ? '✓' : '✗'} ${n}`);

// 关键：渲染结果里有没有 `{{`
console.log(`\n  wxml 里含 \`{{\` 的片段数: ${(wxml.match(/\{\{/g) ?? []).length}`);
const sample = wxml.match(/class="[^"]*\"/g) ?? [];
const dyn = sample.filter((s) => s.includes('{{'));
console.log(`  class 属性总数: ${sample.length}  其中含绑定: ${dyn.length}`);
if (dyn.length) console.log(`    例子: ${dyn.slice(0, 4).join('  |  ').slice(0, 300)}`);

try { mp.disconnect(); } catch { /* 同步 */ }
