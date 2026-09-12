// 實測 /feedback 這條路由：讀、寫、以及三個守衛。
// 寫進去的測試行用完就撤（會改庫的探針必須自己收拾）。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFeedback } from '../tools/lib/feedback.mjs';

const PORT = 3841;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_KEY = 'selftest:route:probe';

const srv = spawn('node', ['tools/swagger/server.mjs'], {
  cwd: 'G:/My Drive/Workplace/China KG Platform/hualong-teacher',
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', () => {});
srv.stderr.on('data', (d) => console.error('  [srv]', String(d).slice(0, 200)));

// 等就绪
for (let i = 0; i < 30; i++) {
  await sleep(400);
  try { const r = await fetch(`${BASE}/feedback`); if (r.ok) break; } catch { /* 还没起 */ }
}

const show = (name, res, body) => console.log(`  ${name.padEnd(34)} HTTP ${res.status}  ${String(body).slice(0, 90)}`);

// ① 讀
const g = await fetch(`${BASE}/feedback`);
const gj = await g.json();
show('① GET /feedback', g, `rows=${gj.rows.length} values=${gj.values.join('/')}`);

const before = readFeedback().size;
console.log(`     寫前 tsv 行數: ${before}`);

// ② 正常寫
const w = await fetch(`${BASE}/feedback`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ key: TEST_KEY, status: '已知', note: '路由自測，用完即撤', reviewer: 'selftest' }),
});
show('② POST 正常', w, await w.text());

// ③ 詞表外的 status
const bad = await fetch(`${BASE}/feedback`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ key: 'x:y:z', status: '瞎寫的', reviewer: 'selftest' }),
});
show('③ POST 詞表外 status（應 422）', bad, await bad.text());

// ④ 缺 reviewer
const noRev = await fetch(`${BASE}/feedback`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ key: 'x:y:z', status: '已知' }),
});
show('④ POST 缺 reviewer（應 422）', noRev, await noRev.text());

// ⑤ 跨源 Origin
const cross = await fetch(`${BASE}/feedback`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
  body: JSON.stringify({ key: 'x:y:z', status: '已知', reviewer: 'x' }),
});
show('⑤ POST 跨源 Origin（應 403）', cross, await cross.text());

// ⑥ 錯的 content-type
const wrongCt = await fetch(`${BASE}/feedback`, {
  method: 'POST',
  headers: { 'content-type': 'text/plain' },
  body: '{}',
});
show('⑥ POST text/plain（應 415）', wrongCt, await wrongCt.text());

// ⑦ 收拾：把測試行撤掉
const { readFeedback: rf, writeFeedback: wf } = await import('../tools/lib/feedback.mjs');
const rows = rf();
const had = rows.delete(TEST_KEY);
wf(rows);
console.log(`\n  收拾：測試行 ${had ? '已撤' : '本來就沒有'}；tsv 現在 ${rf().size} 行（應為 ${before}）`);
console.log(rf().size === before ? '  ✓ 回到寫前的行數' : '  ✗ 行數沒回到原樣');

srv.kill();
process.exit(0);
