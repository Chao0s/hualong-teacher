/**
 * 逐頁對照：**原型意圖 ↔ 渲染出來的實際 class**。
 *
 * 為什麼要有這一支：`/pages` 那一頁現在把「原型的意圖」與「客戶端調的操作」並排了，
 * 但那兩邊都是**讀原始碼**算出來的。螢幕上真正畫出來的是什麼，只有渲染看得見。
 *
 * 這一支補上第三邊：把每一屏真的渲染一次，讀它的 WXML，抽出 class，
 * 然後問「原型標了意圖的那個 class，渲染出來了嗎」。
 *
 * 判據（三種，分開報，不合併）：
 *   ✓ 有對應   原型的 class 在渲染出來的 WXML 裡找得到
 *   ✗ 沒畫出來 原型標了，渲染結果裡沒有 —— **這是真的漂移**（意圖沒落地）
 *   ⚠ 讀不到   原型檔不存在，或那一屏要參數進不去 —— **不判成缺陷**，只說讀不到
 *
 * 前提：自動化會話已經開著（先跑 `npm run render`，它會把 IDE 留著）。
 * 這一支**只接不啟** —— 啟動邏輯只該有一份，在 `render-pages.mjs` 裡。
 * 它也**不呼叫 `mp.close()`**：那會把共享的會話關掉。
 */
import { Automator } from '@weapp-vite/miniprogram-automator';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { intentsOf } from '../tools/lib/intent-join.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const OUT = join(REPO, '.scratch', 'render-compare');
const PORT = Number(process.env.WX_AUTO_PORT ?? 9420);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pages = JSON.parse(readFileSync(join(REPO, 'miniprogram', 'app.json'), 'utf8'))
  .pages.map((p) => ({ route: `/${p}`, screen: p.split('/')[1] }));

let mp;
try {
  mp = await new Automator().connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
} catch {
  console.error(`连不上 ws://127.0.0.1:${PORT}。先跑一次 \`npm run render\`（它会把 IDE 留着），再跑这一支。`);
  process.exit(2);
}
console.log(`  ✓ 已连上（${pages.length} 屏）`);

// 就绪闸门 —— 连上不等于工程载入完（今天为此 56 屏全红过一次）
let ready = false;
for (let i = 1; i <= 30; i++) {
  try { const p = await mp.currentPage(); if (p?.path) { ready = true; break; } } catch { /* 还没好 */ }
  await sleep(2000);
}
if (!ready) { console.error('  工程一直没载入出页面，停手。'); process.exit(2); }
console.log('  ✓ 工程就绪\n');

mkdirSync(OUT, { recursive: true });
const results = [];

for (const { route, screen } of pages) {
  const intents = intentsOf(`screens/${screen}.html`);
  const row = { screen, route, intents: intents.length, drawn: [], renamed: [], missing: [], note: '' };

  if (!existsSync(join(REPO, 'screens', `${screen}.html`))) {
    row.note = '没有原型档，无从对照';
    results.push(row);
    console.log(`  ⚠ ${screen.padEnd(34)} 没有原型档`);
    continue;
  }

  let wxml = '';
  try {
    await mp.reLaunch(route);
    await sleep(700);
    const page = await mp.currentPage();
    if (!page?.path || page.path !== route.replace(/^\//, '')) {
      // 会自己跳走的屏（登录页已登录时跳首页）—— 读不到这一屏，但不是缺陷
      row.note = `自己跳到 ${page?.path ?? '(取不到)'}，读不到这一屏`;
      results.push(row);
      console.log(`  ⚠ ${screen.padEnd(34)} 自行跳走，略过`);
      continue;
    }
    wxml = String(await page.wxml());
  } catch (e) {
    row.note = `渲染失败：${String(e.message ?? e).slice(0, 80)}`;
    results.push(row);
    console.log(`  ✗ ${screen.padEnd(34)} 渲染失败`);
    continue;
  }

  // 渲染結果里出现过哪些 class（含 `class="a b"` 的多值）
  const classes = new Set();
  for (const m of wxml.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  }

  /** 把 `a-b-c` 与 `a__b__c` 视作同一个名字 —— 两种命名习惯指的是同一个元素。 */
  const norm = (s) => s.replace(/-/g, '__').replace(/_{3,}/g, '__');
  const classesNorm = new Set([...classes].map(norm));

  // 意图 id 形如 `home.quick-item`。**取第一个点之后的全部**（有的有三段，例如
  // `home.quick-item.on`），再取最后一段当状态修饰去掉。
  for (const it of intents) {
    const dot = it.id.indexOf('.');
    const raw = dot >= 0 ? it.id.slice(dot + 1) : it.id;
    // 三段以上时，中间那些才是 class，末段是状态修饰（`on`、`active` 之类）
    const parts = raw.split('.');
    const cls = parts[0];

    if (classes.has(cls)) row.drawn.push(it.id);
    else if (classesNorm.has(norm(cls))) row.renamed.push({ intent: it.id, as: [...classes].find((c) => norm(c) === norm(cls)) });
    else row.missing.push(it.id);
  }

  results.push(row);
  const flag = row.missing.length ? '✗' : row.renamed.length ? '~' : '✓';
  console.log(`  ${flag} ${screen.padEnd(34)} 意圖 ${String(row.intents).padStart(3)}  同名 ${String(row.drawn.length).padStart(3)}  异名 ${String(row.renamed.length).padStart(3)}  没画 ${row.missing.length}`);
}

writeFileSync(join(OUT, 'compare.json'), JSON.stringify(results, null, 2), 'utf8');

const withProto = results.filter((r) => r.intents > 0);
const sum = (k) => withProto.reduce((n, r) => n + r[k].length, 0);
const totalIntents = withProto.reduce((n, r) => n + r.intents, 0);

console.log(`\n  有原型的屏 ${withProto.length} 屏  意圖共 ${totalIntents} 个`);
console.log(`  同名画出来 ${sum('drawn')}   异名（同一元素、两种命名）${sum('renamed')}   没画出来 ${sum('missing')}`);

const renamed = withProto.filter((r) => r.renamed.length);
if (renamed.length) {
  console.log('\n  异名（同一個元素、兩邊叫法不同 —— 這一類 join 不上，但不是缺失）：');
  for (const r of renamed.slice(0, 6)) {
    console.log(`    ${r.screen}：${r.renamed.slice(0, 3).map((x) => `${x.intent} → ${x.as}`).join('  ')}`);
  }
  if (renamed.length > 6) console.log(`    …还有 ${renamed.length - 6} 屏`);
}

const missing = withProto.filter((r) => r.missing.length);
if (missing.length) {
  console.log('\n  真的没画出来（原型有意圖、渲染結果裡連異名都找不到）：');
  for (const r of missing.slice(0, 8)) {
    console.log(`    ${r.screen} (${r.missing.length})：${r.missing.slice(0, 4).join(', ')}`);
  }
  if (missing.length > 8) console.log(`    …还有 ${missing.length - 8} 屏`);
}
console.log(`\n  明细写到 ${join(OUT, 'compare.json')}`);

// **必须断开连接，并且显式退出。**
// 不写这两行，脚本印完结果却一直不退 —— 挂着的那几个进程会去抢同一个自动化会话
// （每个都在导航页面，互相覆盖），下一个人看到的是「跑不完、看起来只是慢」。
// 2026-09-12 就是这么攒了 2 个僵尸进程出来。
// `disconnect()` 只断连接、不关会话（会话是共享资源）；`exit` 是防它有别的句柄没释放。
try { mp.disconnect(); } catch { /* 新版 disconnect 是同步的 */ }
process.exit(0);
