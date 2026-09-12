// 核子代理改寫後有沒有掉東西 —— 比對識別碼集合（決議編號、G 編號、表名、欄名）。
// 不比對散文：散文本來就該被改寫。比對的是**不能動的那些**。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO_B = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';
const REPO_T = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';

const PATTERNS = {
  '決議編號': /\b(?:F|E|B|D|W|Q)\d{1,2}(?:-[a-z0-9]+)?\b/g,
  'G 編號': /\bG\d{1,3}\b/g,
  '表名': /\bdb_[a-z_]+\b/g,
  '章節號': /§\d+(?:\.\d+)*/g,
};

const grab = (text) => {
  const out = {};
  for (const [name, re] of Object.entries(PATTERNS)) {
    out[name] = new Set([...text.matchAll(re)].map((m) => m[0]));
  }
  return out;
};

const compare = (label, repo, rel) => {
  let old;
  try {
    old = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: repo, maxBuffer: 1 << 26 }).toString('utf8');
  } catch { console.log(`  ${label}: 不在 HEAD 裡，跳過`); return; }
  const now = readFileSync(`${repo}/${rel}`, 'utf8');

  const a = grab(old), b = grab(now);
  console.log(`\n${label}`);
  console.log(`  行數 ${old.split('\n').length} → ${now.split('\n').length}`);

  let bad = 0;
  for (const k of Object.keys(PATTERNS)) {
    const lost = [...a[k]].filter((x) => !b[k].has(x));
    const added = [...b[k]].filter((x) => !a[k].has(x));
    const mark = lost.length ? '✗' : '✓';
    if (lost.length) bad++;
    console.log(`  ${mark} ${k.padEnd(8)} 原有 ${String(a[k].size).padStart(4)} → 現有 ${String(b[k].size).padStart(4)}` +
      (lost.length ? `  掉了 ${lost.length}: ${lost.slice(0, 8).join(', ')}` : '') +
      (added.length ? `  多了 ${added.length}: ${added.slice(0, 5).join(', ')}` : ''));
  }
  return bad;
};

let total = 0;
total += compare('DECISIONS.md（行數降了 19，要看）', REPO_B, 'DECISIONS.md');
total += compare('GAPS.md', REPO_B, 'db/GAPS.md');
total += compare('DATABASE_SPEC.md', REPO_B, 'db/DATABASE_SPEC.md');
total += compare('ADR-0013-growth-book-composition-manifest.md', REPO_B, 'docs/ADR-0013-growth-book-composition-manifest.md');
total += compare('teacher-miniprogram-spec.md', REPO_T, 'docs/frontend spec files/teacher-miniprogram-spec.md');
total += compare('2026-09-12-ticket-01-next-session.md', REPO_T, 'docs/handoff/2026-09-12-ticket-01-next-session.md');
total += compare('PRD_MiniProgram_API_Contract_Gap_Scanner.md', REPO_T, 'tools/PRD_MiniProgram_API_Contract_Gap_Scanner.md');

console.log(`\n${total === 0 ? '✓ 六份的識別碼集合一字未失' : `✗ 有 ${total} 類識別碼掉了 —— 要回退那幾份`}`);
