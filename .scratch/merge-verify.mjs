/**
 * merge-verify.mjs —— 「檢測評審併進按螢幕看」這一件改動的實測。逐項對應 a–e。
 *
 * 只讀 + 起一次服務（自己開一個埠，跑完殺掉）。不改倉庫任何東西。
 *
 *   node .scratch/merge-verify.mjs
 *
 * 全過 → 退出碼 0。任一項不過 → 退出碼 1，並印出錯在哪一項。
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();
const PORT = Number(process.env.MV_PORT || 18459);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fails = [];
const ok = (cond, label) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}`);
  if (!cond) fails.push(label);
};
const cjk = (s) => /[\u4e00-\u9fff]/.test(s);
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

// ── 起服務（自己開埠，先確認回應真的來自這一次的行程）──────────────────────
console.log(`\n=== 起服務 PORT=${PORT} ===`);
const child = spawn('node', [join(REPO, 'tools', 'swagger', 'server.mjs')], {
  cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
child.stdout.on('data', (d) => { bootLog += d; });
child.stderr.on('data', (d) => { bootLog += d; });

let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await sleep(250);
  try { const r = await fetch(`${BASE}/pages`); up = r.status === 200; } catch { /* 还没起来 */ }
}
ok(up, `服务起来了（${BASE}/pages 回 200）`);
console.log(bootLog.trim().split('\n').map((l) => `        ${l}`).join('\n'));
if (!up) { child.kill(); process.exit(1); }

// 这一条防的是「舊行程還活著、新行程 EADDRINUSE 默默死掉」——那會量到舊碼。
const pages = await (await fetch(`${BASE}/pages`)).text();
ok(pages.includes('意圖 ↔ 操作'), '这一份 HTML 是**新码**画的（找得到「意圖 ↔ 操作」这一段）');

console.log('\n=== [a] /pages 一页里同时有 API 行与意圖行，而且每一行都能留结论 ===');
const cards = pages.match(/<section class="card" id="s-/g) || [];
ok(cards.length > 0, `屏幕卡的容器 class 找得到（<section class="card" id="s-…">，${cards.length} 个）`);

// 每一屏的「意圖 N 個 · 操作 M 條」直接从卡片里读出来
const perScreen = [];
const cardSegs = pages.split('<section class="card" id="s-').slice(1);
for (const seg of cardSegs) {
  const screen = seg.slice(0, seg.indexOf('"'));
  const t = seg.match(/意圖 <b>(\d+)<\/b> 个 · 操作 <b>(\d+)<\/b> 条/);
  if (t) perScreen.push({ screen, intents: Number(t[1]), ops: Number(t[2]) });
}
const intentRows = (pages.match(/data-key="intent:join:/g) || []).length;
ok(intentRows > 0, `意圖行总数 > 0（实测 ${intentRows} 行）`);
console.log(`        前几屏「意圖 N 個 / 操作 M 條」（有意图表的屏 ${perScreen.length} 个）:`);
for (const s of perScreen.slice(0, 6)) console.log(`          ${s.screen.padEnd(34)} 意圖 ${String(s.intents).padStart(3)} 個 / 操作 ${String(s.ops).padStart(2)} 條`);

const selects = (pages.match(/<select class="st"/g) || []).length;
const inputs = (pages.match(/<input class="nt"/g) || []).length;
ok(selects >= cards.length, `结论下拉数量 ${selects} ≥ 螢幕数 ${cards.length}`);
ok(inputs >= cards.length, `理由输入框数量 ${inputs} ≥ 螢幕数 ${cards.length}`);
ok(selects === inputs, `下拉与输入框一一对应（${selects} / ${inputs}）`);
// 每一屏都有意圖行：57 屏里应该有 55 屏有意图表（login 与 (utils) 没有原型）
const withIntentTable = (pages.match(/class="itbl"/g) || []).length;
ok(withIntentTable === cards.length, `每一屏都有意圖表（${withIntentTable} 张表 / ${cards.length} 屏）`);
const nWithIntents = perScreen.filter((s) => s.intents > 0).length;
ok(nWithIntents > 0, `${nWithIntents} 屏的原型真的标了 data-intent（其余几屏没有原型档，表里写明「没有意圖可看」）`);
// 每一行都有 key 与保存钮
const keys = (pages.match(/data-key="([^"]+)"/g) || []).length;
const buttons = (pages.match(/<button class="sv"/g) || []).length;
ok(keys === buttons && keys > 0, `每一行一个 key 与一个保存钮（key ${keys} / 保存钮 ${buttons}）`);
const apiRowKeys = (pages.match(/data-key="op:row:/g) || []).length;
ok(apiRowKeys > 0, `API 行的 key 也在（${apiRowKeys} 行）`);

// /pages 里不再有第二个页面视图
console.log('\n        —— /pages 里不再有第二个页面视图 ——');
ok(!existsSync(join(REPO, 'tools', 'swagger', 'review-view.mjs')), 'tools/swagger/review-view.mjs 已删掉（档不在）');
let importers = 0;
for (const dir of ['tools/swagger', 'tools', 'tools/lib']) {
  for (const f of readdirSync(join(REPO, dir)).filter((x) => x.endsWith('.mjs'))) {
    const t = readFileSync(join(REPO, dir, f), 'utf8');
    if (/review-view|reviewPage\s*\(/.test(t)) { importers++; console.log(`        !! ${dir}/${f} 还引用着它`); }
  }
}
ok(importers === 0, `全仓没有一处 import review-view / 调 reviewPage（实测 ${importers} 处）`);
ok((pages.match(/<title>/g) || []).length === 1, `/pages 只有一份 <title>（实测 ${(pages.match(/<title>/g) || []).length} 份）`);
ok(!pages.includes('href="/review"'), '/pages 的顶栏不再给出 /review 这条链接');

console.log('\n=== [a2] 已经存过的结论要回显（写一发真的，验完删掉还原本档）===');
const FB = join(REPO, 'docs', 'audit', 'checker-feedback.tsv');
const { createHash } = await import('node:crypto');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const original = readFileSync(FB);
const TEST_KEY = 'screen:card:home';
const TEST_NOTE = 'merge-verify 实测：这一行是回显用的，跑完就删';
try {
  const post = await fetch(`${BASE}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: TEST_KEY, status: '待決', note: TEST_NOTE, reviewer: 'merge-verify' }),
  });
  const pj = await post.json();
  ok(post.status === 201 && pj.ok, `POST /feedback 存下 ${TEST_KEY}（HTTP ${post.status}，created=${pj.created}）—— 走的是既有那一条路由，没有新写 API`);
  const after2 = await (await fetch(`${BASE}/pages`)).text();
  const seg = after2.match(new RegExp(`data-key="${TEST_KEY}"[\\s\\S]{0,900}?</div>`))[0];
  ok(seg.includes('selected') && seg.includes('>待決 —'), '重新载入 /pages：结论下拉把「待決」填回去了（selected）');
  ok(seg.includes(TEST_NOTE), '理由输入框把 note 填回去了');
  ok(seg.includes('已判') && seg.includes('merge-verify'), '这一行标出「已判 + 谁判的 + 哪天」');
} finally {
  // 还原：这份 tsv 是 38 条真结论，测试写进去的那一条必须拿掉，且逐字节还原。
  const { writeFileSync } = await import('node:fs');
  writeFileSync(FB, original);
  ok(sha(readFileSync(FB)) === sha(original), `结论档已逐字节还原（sha256 ${sha(original).slice(0, 12)}…）`);
}

console.log('\n=== [b] /review 回 302 且 Location 指到 /pages ===');
const rr = await fetch(`${BASE}/review`, { redirect: 'manual' });
const loc = rr.headers.get('location');
ok(rr.status === 302, `HTTP ${rr.status}（要 302）`);
ok(loc === '/pages', `location: ${loc}（要 /pages）`);
console.log(`        ${[...rr.headers.entries()].map(([k, v]) => `${k}: ${v}`).join(' | ')}`);
const followed = await fetch(`${BASE}/review`);   // 跟随重定向
ok(followed.status === 200 && (await followed.text()).includes('意圖 ↔ 操作'), '跟随 302 后拿到的就是 /pages 那一份');

console.log('\n=== [c] 英文散文消失：每条发现的英文 what 旁边有中文 ===');
const repDir = join(REPO, 'tools', '.report', 'api-test');
const repFile = readdirSync(repDir).filter((f) => f.endsWith('.json')).sort().pop();
const findings = JSON.parse(readFileSync(join(repDir, repFile), 'utf8')).findings || [];
const lines = pages.split('\n');
let withZh = 0;
for (const f of findings) {
  const needle = escHtml(f.what);
  const at = lines.findIndex((l) => l.includes(needle));
  if (at < 0) { console.log(`        ✗ 找不到这条 what（原文没保留）：${f.what.slice(0, 50)}…`); continue; }
  // 同一行或紧邻两行里要有中文
  const near = [lines[at - 1] || '', lines[at], lines[at + 1] || ''].join(' ');
  if (cjk(near)) withZh++;
}
ok(findings.length > 0, `这一份报告有 ${findings.length} 条发现（${repFile}）`);
ok(withZh === findings.length, `${withZh}/${findings.length} 条发现的英文原文旁边找得到中文`);
// 英文原文与 kind 都还在（以后要 grep）
const kindsInReport = [...new Set(findings.map((f) => f.kind))];
ok(kindsInReport.every((k) => pages.includes(k)), `报告里出现过的 kind 全部照留（${kindsInReport.join(', ')}）`);

// 17 种 kind 全在层源码里声明过 —— 拿它当权威名单
const layerKinds = new Set();
for (const dir of ['layers', 'lib']) {
  const p = join(REPO, '.claude', 'skills', 'hualong-api-test', dir);
  for (const f of readdirSync(p).filter((x) => x.endsWith('.mjs'))) {
    for (const m of readFileSync(join(p, f), 'utf8').matchAll(/kind: *'([a-z-]+)'/g)) layerKinds.add(m[1]);
  }
}
const { KIND_ZH } = await import('../tools/lib/finding-eli10.mjs');
const covered = [...layerKinds].filter((k) => KIND_ZH.has(k));
// **不写死条数。** 这里从前断言「共 17 种」，而 kind 是会增加的：渲染层加一个
// `draws-failure`，这个数字就过期，而加的人不会知道要改这里。写死之后，它测的是
// 「上次数到几」，不是「有没有中文」—— 与本仓记过的写死计数是同一种毛病。
//
// 真正要守的是两件：扫描扫到了东西（不是 0，否则可能是扫描自己坏了），
// 以及每一种都有中文（下一行）。
ok(layerKinds.size > 0, `检测层声明的 kind 扫到 ${layerKinds.size} 种（要 > 0）`);
ok(covered.length === layerKinds.size, `${covered.length}/${layerKinds.size} 种 kind 有中文`);
console.log(`        有中文的 kind：${covered.join(', ')}`);
const missing = [...layerKinds].filter((k) => !KIND_ZH.has(k));
if (missing.length) console.log(`        缺中文：${missing.join(', ')}`);
// 「不得出现只给机器看的英文散文」：把可见文字里「>=5 个英文词、且整段没有中文」的段落挑出来，
// 每一段都必须是报告里某条发现的 what（那是机器产生的英文原文，要求照留）。
{
  const visible = pages.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '');
  const prose = [...new Set(visible.split(/<[^>]*>/).map((s) => s.trim()).filter((s) => {
    if (cjk(s)) return false;
    return s.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length >= 5;
  }))];
  const whats = new Set(findings.map((f) => f.what));
  const stray = prose.filter((s) => !whats.has(s));
  ok(prose.length > 0, `页面上确实带着机器英文原文（${prose.length} 段，全部来自发现的 what）`);
  ok(stray.length === 0, `除了发现的英文原文，页面上没有别的英文散文${stray.length ? `（多出 ${stray.length} 段：${stray[0].slice(0, 60)}…）` : ''}`);
}

console.log('\n=== [d] 改前／改后对比 ===');
const beforeFile = join(REPO, '.scratch', 'pages-before.html');
const reviewBefore = join(REPO, '.scratch', 'review-before.html');
const stat = (html) => ({
  bytes: Buffer.byteLength(html, 'utf8'),
  screens: (html.match(/<section class="card" id="s-/g) || []).length,
  intentRows: (html.match(/data-key="intent:join:/g) || []).length,
  intentTables: (html.match(/class="itbl"/g) || []).length,
  controls: (html.match(/<select class="st"|<select[^>]*aria-label="结论"/g) || []).length,
});
const after = stat(pages);
if (existsSync(beforeFile)) {
  const b = stat(readFileSync(beforeFile, 'utf8'));
  console.log(`        /pages   改前 ${kb(b.bytes).padStart(8)} · 螢幕卡 ${b.screens} · 意圖行 ${b.intentRows} · 意圖表 ${b.intentTables} · 可写控件 ${b.controls}`);
  console.log(`        /pages   改后 ${kb(after.bytes).padStart(8)} · 螢幕卡 ${after.screens} · 意圖行 ${after.intentRows} · 意圖表 ${after.intentTables} · 可写控件 ${after.controls}`);
  ok(b.controls === 0 && after.controls > 0, `可写控件 0 → ${after.controls}`);
  ok(b.intentRows === 0 && after.intentRows > 0, `意圖行 0 → ${after.intentRows}`);
  ok(after.screens === b.screens, `螢幕卡数不变（${b.screens} → ${after.screens}）`);
} else {
  console.log(`        找不到 ${beforeFile}（改前那一份），只印改后：${kb(after.bytes)} · 螢幕卡 ${after.screens} · 意圖行 ${after.intentRows} · 可写控件 ${after.controls}`);
}
if (existsSync(reviewBefore)) {
  const rb = readFileSync(reviewBefore, 'utf8');
  console.log(`        /review  改前 ${kb(Buffer.byteLength(rb, 'utf8'))} 一页英文散文（有自己的 view）· 改后 → 302 转 /pages（见 [b]）`);
}

// 造出来的 key：把一个实例印出来给报告用
console.log('\n        —— 造出来的 key 长什么样 ——');
for (const shape of ['screen:card:', 'op:row:', 'intent:join:', 'op:unused:']) {
  const m = pages.match(new RegExp(`data-key="(${shape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"`));
  console.log(`        ${shape.padEnd(14)} ${m ? m[1] : '（这一份报告里没有）'}`);
}

console.log('\n=== [e] npm test ===');
const test = spawn('npm', ['test'], { cwd: REPO, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
test.stdout.on('data', (d) => { out += d; });
test.stderr.on('data', (d) => { out += d; });
const code = await new Promise((r) => test.on('close', r));
console.log(out.trimEnd().split('\n').map((l) => `        ${l}`).join('\n'));
ok(code === 0, `npm test 退出码 ${code}（要 0）`);

child.kill();
console.log(`\n${fails.length ? `===== 未通过 ${fails.length} 项 =====` : '===== 全部通过 ====='}`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
