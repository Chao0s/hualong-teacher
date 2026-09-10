/**
 * 一次性：把 docs/audit/wiring-issues-2026-09-08.part*.json 建成 GitHub 子票，挂到地图 #1 下，
 * 再按 blockedBy 加原生依赖。幂等：已建过的（title 相同）跳过。
 *
 *   HTTPS_PROXY=http://127.0.0.1:7890 node tools/wayfinder-create.mjs <map-number>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = 'Chao0s/hualong-teacher';
const MAP = Number(process.argv[2]);
if (!MAP) { console.error('用法：node tools/wayfinder-create.mjs <map-number>'); process.exit(1); }

const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 1e7 }).trim();
// 默认建 2026-09-08 那两批；也可以指定别的规格文件：node tools/wayfinder-create.mjs <map> <file.json> ...
const PARTS = process.argv.slice(3).length ? process.argv.slice(3) : ['docs/audit/wiring-issues-2026-09-08.part1.json', 'docs/audit/wiring-issues-2026-09-08.part2.json'];
const tickets = PARTS.flatMap((p) => JSON.parse(readFileSync(p, 'utf8')));

// 依赖表：谁阻着谁（id → 被它阻的 id）
const BLOCKED_BY = {
  'L4-profile': ['L1-media', 'L1-download'],
  'L4-assess': ['L3-schema', 'L4-scales'],
  'L6-assess-pages': ['L4-assess', 'L1-message'],
  'L6-gb-pages': ['L4-gb-status', 'L4-lock', 'L6-topic'],
  'L1-writes': ['L4-tasks'],
  'L1-pagetap': [],
  'L4-myuploads': ['L4-withdraw'],
};

const existing = JSON.parse(gh(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '200', '--json', 'number,title']));
const byTitle = new Map(existing.map((i) => [i.title, i.number]));
const mapDbId = gh(['api', `repos/${REPO}/issues/${MAP}`, '--jq', '.id']);

const created = {};
for (const t of tickets) {
  let n = byTitle.get(t.title);
  if (!n) {
    const url = gh(['issue', 'create', '--repo', REPO, '--title', t.title, '--label', `wayfinder:${t.type}`, '--label', `wiring:${t.layer}`, '--body-file', '-'], `Part of #${MAP}\n\n${t.body}`);
    n = Number(url.split('/').pop());
    console.log(`建 #${n} ${t.title}`);
  } else console.log(`已有 #${n} ${t.title}`);
  created[t.id] = n;
}

// 挂成子票
for (const t of tickets) {
  const n = created[t.id];
  const dbId = gh(['api', `repos/${REPO}/issues/${n}`, '--jq', '.id']);
  try {
    gh(['api', '--method', 'POST', `repos/${REPO}/issues/${MAP}/sub_issues`, '-F', `sub_issue_id=${dbId}`]);
  } catch (e) { if (!/already|duplicate/i.test(String(e.stderr || e.message))) console.log(`  子票挂载失败 #${n}: ${String(e.stderr || e.message).split('\n')[0]}`); }
}

// 原生依赖
// 规格文件里也可以写 blockedBy: ["L4-lock", "#27"]（票 id 或现成的 issue 号）
for (const t of tickets) for (const b of t.blockedBy || []) (BLOCKED_BY[t.id] ||= []).push(b);
const numberOf = (ref) => (String(ref).startsWith('#') ? Number(ref.slice(1)) : created[ref]);
for (const [child, blockers] of Object.entries(BLOCKED_BY)) {
  if (!created[child]) continue;
  for (const b of blockers) {
    if (!numberOf(b)) continue;
    const blockerDb = gh(['api', `repos/${REPO}/issues/${numberOf(b)}`, '--jq', '.id']);
    try {
      gh(['api', '--method', 'POST', `repos/${REPO}/issues/${created[child]}/dependencies/blocked_by`, '-F', `issue_id=${blockerDb}`]);
      console.log(`阻塞 #${created[child]} ← #${created[b]}`);
    } catch (e) { console.log(`  依赖失败 #${created[child]} ← #${created[b]}: ${String(e.stderr || e.message).split('\n')[0]}`); }
  }
}
writeFileSync('docs/audit/wiring-issues-2026-09-08.numbers.json', JSON.stringify({ map: MAP, tickets: created }, null, 2) + '\n');
console.log(`完成：${Object.keys(created).length} 张子票，编号写在 docs/audit/wiring-issues-2026-09-08.numbers.json`);
