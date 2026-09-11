// 對稱表的第一個樣子：把「原型的意圖」與「客戶端實際調的操作」並排，逐屏看。
// 兩邊現在都有 id（意圖 = data-intent，操作 = operationId），所以擺得出來。
// **這不是最終對稱表** —— 它是給人判斷「這是不是你要的東西」的樣本。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const BACKEND = join(REPO, '..', 'hualong-backend');

const readTsv = (p) => {
  const rows = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const head = rows[0].split('\t');
  return rows.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? ''])));
};

// 原型意圖：從已標記的 data-intent 讀
const intentsOf = (screen) => {
  try {
    const html = readFileSync(join(REPO, 'screens', `${screen}.html`), 'utf8');
    const m = new Map();
    for (const x of html.matchAll(/data-intent="([^"]+)"/g)) m.set(x[1], (m.get(x[1]) ?? 0) + 1);
    return [...m.entries()].map(([id, n]) => ({ id, n }));
  } catch { return []; }
};

const ops = readTsv(join(BACKEND, 'db', 'spec', 'screen-operations.tsv'));
const reg = readTsv(join(BACKEND, 'api', 'action-registry.tsv'));
const screens = readTsv(join(BACKEND, 'db', 'spec', 'screens.tsv'));

// 屏 → 主表（讀用）
const screenNameOf = (s) => ((s.mp_file ?? '').match(/pages\/([^/]+)\//) ?? [, ''])[1];
const tableByScreen = new Map();
for (const s of screens) { const k = screenNameOf(s); if (k) tableByScreen.set(k, s.primary_tables); }

const norm = (p) => p.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');
const regByRoute = new Map(reg.filter((a) => a.method && a.path).map((a) => [`${a.method.toUpperCase()} ${norm(a.path)}`, a]));

// **`(契約外)` 要問契約，不是問登記表。**
// 2026-09-12 用 `action-registry` 判，而它只登記**寫**，於是每一條**讀**都被誤標「契約外」
// （`listBookSections` 明明在 openapi.yaml 裡）。那是同一個「兩條來源各管一半」的錯，
// 在 join-chain 那邊也犯過一次。
const openapi = readFileSync(join(BACKEND, 'api', 'openapi.yaml'), 'utf8');
const declared = new Set([...openapi.matchAll(/operationId:\s*(\w+)/g)].map((m) => m[1]));

const SHOW = (process.argv[2] ?? 'home,growth-book-edit,teacher-monthly-evaluation').split(',');

for (const screen of SHOW) {
  const intents = intentsOf(screen);
  const rows = ops.filter((o) => o.screen === screen);
  const tables = tableByScreen.get(screen) ?? '(未登記)';

  console.log(`\n${'='.repeat(78)}`);
  console.log(`屏  ${screen}      主表 ${tables}`);
  console.log(`意圖 ${intents.length} 個 · 操作 ${rows.length} 條`);
  console.log('='.repeat(78));

  if (!intents.length && !rows.length) { console.log('  （兩邊都空）'); continue; }

  console.log(`  ${'意圖（原型有標記的）'.padEnd(34)} ${'次'}  ${'操作（客戶端實際調的）'}`);
  console.log('  ' + '-'.repeat(74));
  const n = Math.max(intents.length, rows.length);
  for (let i = 0; i < n; i++) {
    const it = intents[i];
    const op = rows[i];
    const left = it ? it.id.padEnd(34) : ''.padEnd(34);
    const cnt = it ? String(it.n).padStart(2) : '  ';
    let right = '';
    if (op) {
      const offContract = op.operation_id && !declared.has(op.operation_id);
      right = op.operation_id ? `${op.operation_id}${offContract ? '  (契約外)' : ''}` : '(此屏無操作)';
    }
    console.log(`  ${left} ${cnt}  ${right}`);
  }

  const unpaired = rows.filter((o) => /原型有意圖未對上/.test(o.trigger_flag ?? '')).length;
  const matched = rows.filter((o) => (o.trigger_prototype ?? '').trim()).length;
  console.log(`  -`.repeat(1) + ` 對得上 ${matched} · 待配 ${unpaired} · 純讀(無觸發) ${rows.filter((o) => !(o.trigger_wxml ?? '').trim()).length}`);
}
