/**
 * 把鏈條接起來：屏 → 操作 → 資料表 → 桶。
 *
 *   node .claude/skills/hualong-api-test/scripts/join-chain.mjs
 *
 * 為什麼做它：設計意圖是「每個意圖都觸得到 VM／DB／bucket」。
 * 四段資料**本來就有**，只是**沒有任何產物把它們 join 起來**：
 *
 *   screen-operations.tsv   screen → operation_id            （一屏一操作一行）
 *   action-registry.tsv     action → target_table / also_writes / side_effects
 *   screens.tsv             mp_file → primary_tables
 *   db_file                 → COS 物件鍵（本工具只標「有沒有檔案側」）
 *
 * **兩條來源各管一半，不能混**（2026-09-12 就用錯過一次）：
 *   **寫** → `action-registry.target_table` —— 它登記的是動作，不是讀
 *   **讀** → `screens.tsv.primary_tables`  —— 屏級，屏名從 `mp_file` 推
 *   （`screens.tsv.surface` 的值是 `miniprogram`／`pc-backend`，**不是屏名**）
 *
 * 本工具**只讀**，寫一份對照到 `.scratch/chain.md`。接不上的一律列出，**不靜默跳過** ——
 * 接不上本身就是發現（那一格就是「意圖沒有落點」）。
 *
 * 注意 `node --check` 只驗語法、不驗綁定：`resolve` 沒 import 它也會說語法通過。
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const BACKEND = join(REPO, '..', 'hualong-backend');
const SPEC = join(BACKEND, 'db', 'spec');
const API = join(BACKEND, 'api');
const OUT = join(REPO, '.scratch', 'chain.md');

const readTsv = (p) => {
  if (!existsSync(p)) throw new Error(`缺檔：${p}`);
  const rows = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const head = rows[0].split('\t');
  return rows.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? ''])));
};

const screenOps = readTsv(join(SPEC, 'screen-operations.tsv'));
const actionReg = readTsv(join(API, 'action-registry.tsv'));
const screens = readTsv(join(SPEC, 'screens.tsv'));

// 動作登記表按 method+path 索引（operation 與 action 之間的橋是這個）
const norm = (p) => p.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');
const registryByRoute = new Map();
for (const a of actionReg) {
  if (!a.method || !a.path) continue;
  registryByRoute.set(`${a.method.toUpperCase()} ${norm(a.path)}`, a);
}

// screens.tsv 按**屏名**索引 —— 屏名要從 `mp_file` 推，不是 `surface`。
// `surface` 的值是 `miniprogram`／`prototype`／`pc-backend`（**客户端種類**，不是屏名）。
// 2026-09-12 就用錯了這一格：索引鍵對不上，兜底一次都沒觸發，
// 於是把 78 行報成「接不上」，而其中 68 是**讀** —— 讀本來就不在 action-registry 裡。
const screenNameOf = (s) => {
  const m = (s.mp_file ?? '').match(/pages\/([^/]+)\//);
  return m ? m[1] : '';
};
const byScreen = new Map();
for (const s of screens) {
  const k = screenNameOf(s);
  if (k && !byScreen.has(k)) byScreen.set(k, s);
}

// 契約裡的 path → 這個操作「有沒有回檔案」
const openapi = existsSync(join(API, 'openapi.yaml')) ? readFileSync(join(API, 'openapi.yaml'), 'utf8') : '';
const FILE_WORDS = /(\/media\/|download|upload|file|attachment|photo|cover|image)/i;

const rows = [];
for (const o of screenOps) {
  const route = o.method ? `${o.method.toUpperCase()} ${norm(o.path)}` : '';
  const reg = route ? registryByRoute.get(route) : undefined;
  let table = reg?.target_table ?? '';
  let alsoWrites = reg?.also_writes ?? '';
  let source = reg ? 'action-registry(寫)' : '';

  if (!table) {
    const s = byScreen.get(o.screen);
    if (s?.primary_tables) {
      table = s.primary_tables;
      source = reg ? 'screens.tsv(補 also)' : 'screens.tsv(讀)';
    }
  }
  rows.push({
    screen: o.screen,
    operation: o.operation_id || '(無)',
    route: route || '(無)',
    table: table || '(接不上)',
    alsoWrites,
    source: source || '(接不上)',
    bucket: o.path && FILE_WORDS.test(o.path) ? '是（路徑像檔案）' : '',
    gap: o.gap ?? '',
    trigger: o.trigger_prototype || o.trigger_wxml || '',
  });
}

// ── 統計（一個信號一個數，不合成一個總數）─────────────────────────────
const n = rows.length;
const withTable = rows.filter((r) => r.table !== '(接不上)').length;
const viaRegistry = rows.filter((r) => r.source.startsWith('action-registry')).length;
const viaRead = rows.filter((r) => r.source.startsWith('screens.tsv(讀)')).length;
const viaTopUp = rows.filter((r) => r.source.startsWith('screens.tsv(補')).length;
const noRoute = rows.filter((r) => r.route === '(無)').length;
const fileish = rows.filter((r) => r.bucket).length;
const hasTrigger = rows.filter((r) => r.trigger).length;

const lines = [];
lines.push('# 鏈條對照：屏 → 操作 → 資料表 → 桶', '');
lines.push(`由 \`.scratch/join-chain.mjs\` 產生（**只讀**）。對照 ${n} 行。`, '');
lines.push('**兩條來源，各管一半，不能混：**');
lines.push('- **寫** → \`action-registry.target_table\`（它登記的是動作，不是讀）');
lines.push('- **讀** → \`screens.tsv.primary_tables\`（屏級，`mp_file` 推屏名）');
lines.push('');
lines.push('| 指標 | 數 | 說明 |');
lines.push('|---|---:|---|');
lines.push(`| 有 route（method+path） | ${n - noRoute} | 沒有 route 的行＝沒接操作 |`);
lines.push(`| **接得上資料表** | **${withTable}** | 寫經登記表 ${viaRegistry} · 讀經屏登記 ${viaRead} · 登記表缺時由屏補 ${viaTopUp} |`);
lines.push(`| 接不上資料表 | ${n - withTable} | **每一格都是發現**，逐條列在下面 |`);
lines.push(`| 路徑像檔案（涉桶） | ${fileish} | 真正的桶歸屬要 db_file_ref，本工具只標「像」 |`);
lines.push(`| 有觸發詞（原型或 wxml） | ${hasTrigger} | 其餘是純讀，正常 |`);
lines.push('');

const missing = rows.filter((r) => r.table === '(接不上)');
lines.push(`## 接不上的 ${missing.length} 行（＝這幾格意圖沒有落點）`, '');
if (missing.length) {
  lines.push('| 屏 | 操作 | route | 缺口欄 |');
  lines.push('|---|---|---|---|');
  for (const r of missing.slice(0, 60)) lines.push(`| \`${r.screen}\` | ${r.operation || '(無)'} | \`${r.route}\` | ${r.gap || '—'} |`);
  if (missing.length > 60) lines.push(`| … | 其餘 ${missing.length - 60} 行 | | |`);
} else lines.push('（全部接得上）');
lines.push('');

lines.push('## 有資料表的行（前 40，示範對稱表長什麼樣）', '');
lines.push('| 屏 | 操作 | 資料表 | 寫的來源 | 涉桶 |');
lines.push('|---|---|---|---|---|');
for (const r of rows.filter((x) => x.table !== '(接不上)').slice(0, 40)) {
  lines.push(`| \`${r.screen}\` | ${r.operation} | \`${r.table}\` | ${r.source} | ${r.bucket || '—'} |`);
}

writeFileSync(OUT, lines.join('\n'), 'utf8');

console.log(`對照 ${n} 行`);
console.log(`  有 route          ${n - noRoute}`);
console.log(`  接得上資料表      ${withTable}   (寫經登記表 ${viaRegistry} / 讀經屏登記 ${viaRead} / 屏補 ${viaTopUp})`);
console.log(`  接不上資料表      ${n - withTable}`);
console.log(`  路徑像檔案（涉桶） ${fileish}`);
console.log(`  有觸發詞          ${hasTrigger}`);
console.log(`\n對照寫到 ${OUT}`);
if (missing.length) {
  console.log(`\n接不上的前 10 行:`);
  for (const r of missing.slice(0, 10)) console.log(`  ${r.screen.padEnd(28)} ${(r.operation || '(無)').padEnd(26)} ${r.route}`);
}
