// 實測 /review 這一頁：起服務、抓 HTML、檢查該有的東西在不在。
// 不只看狀態碼 —— 「200 但是空殼」正是這一整輪在抓的毛病。
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const PORT = 3842;

// 先跑快集，确保有一份带 key 的报告。
// **它退 1 是正常的** —— 有高級別發現就退 1（那是判紅規則），而報告照样寫出來。
console.log('跑快集（拿新报告）…');
const rr = spawnSync('node', ['.claude/skills/hualong-api-test/run.mjs', 'contract', 'wire', 'cover', 'proto'], { cwd: REPO, encoding: 'utf8' });
console.log(`  run.mjs 退出码 ${rr.status}（非 0 ＝ 有高级别发现，正常）`);

const dir = join(REPO, 'tools', '.report', 'api-test');
const newest = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().pop();
const rep = JSON.parse(readFileSync(join(dir, newest), 'utf8'));
console.log(`  报告 ${newest}：发现 ${rep.findings.length}，可判 ${rep.reviewability.reviewable}，不可判 ${rep.reviewability.unkeyed}`);

const srv = spawn('node', ['tools/swagger/server.mjs'], { cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'pipe'] });
srv.stderr.on('data', (d) => console.error('  [srv]', String(d).slice(0, 200)));
for (let i = 0; i < 40; i++) { await sleep(400); try { if ((await fetch(`http://127.0.0.1:${PORT}/review`)).ok) break; } catch {} }

const r = await fetch(`http://127.0.0.1:${PORT}/review`);
const html = await r.text();
const has = (s) => html.includes(s);
const n = (re) => (html.match(re) ?? []).length;

console.log(`\n  GET /review → HTTP ${r.status}，${html.length} 字节`);
console.log(`  <select> 数:        ${n(/<select/g)}   （应 = 可判发现数 ${rep.reviewability.reviewable}）`);
console.log(`  data-key 行数:      ${n(/tr data-key=/g)}`);
console.log(`  按钮数:             ${n(/class="sv"/g)}`);
console.log(`  选了毒表吗:         ${has('（未审）')}`);
console.log(`  有「不可判」段:      ${n(/条不可判/g)}`);
console.log(`  有「层跳过」段:      ${n(/层跳过/g)}`);
console.log(`  有「不算决议」声明:  ${has('表上选的不算决议')}`);
console.log(`  取词表的路由调用:    ${has("fetch('/feedback')")}`);
console.log(`  写了 POST：         ${has("fetch('/feedback', {")}`);
console.log(`  外面没抄毒表:        ${!has('误报 —')}`);

const ok = r.status === 200 && n(/<select/g) === rep.reviewability.reviewable && has('表上选的不算决议');
console.log(`\n  ${ok ? '✓ 页面成形，下拉与留言都在' : '✗ 有东西没到位'}`);
srv.kill();
process.exit(ok ? 0 : 1);
