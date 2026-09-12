// 剔標記之後，原型裡的「字」有沒有少掉一個 —— 剝掉標籤後逐份比對。
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const DIR = join(REPO, 'screens');
const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

let diff = 0, checked = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.html')).sort()) {
  let old;
  try {
    old = execFileSync('git', ['show', `HEAD:screens/${f}`], { cwd: REPO, maxBuffer: 1 << 24 }).toString('utf8');
  } catch { continue; }
  const now = readFileSync(join(DIR, f), 'utf8');
  checked++;
  if (strip(old) !== strip(now)) {
    diff++;
    console.log(`  ✗ ${f} 的文字变了`);
    const a = strip(old), b = strip(now);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.log(`     舊: …${a.slice(Math.max(0, i - 40), i + 40)}`); console.log(`     新: …${b.slice(Math.max(0, i - 40), i + 40)}`); break; }
    }
  }
}
console.log(`\n  比對 ${checked} 份（HEAD vs 工作區）`);
console.log(`  文字有差異的: ${diff}`);
console.log(diff === 0 ? '  ✓ 一個字都沒掉' : '  ✗ 有掉字，要回退');
