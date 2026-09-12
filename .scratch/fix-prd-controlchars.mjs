/**
 * 修 `tools/PRD_MiniProgram_API_Contract_Gap_Scanner.md` 裡的 13 個控制字元。
 *
 * 這不是這次改寫造成的 —— 它在 `git HEAD` 裡就有。成因看起來是某次
 * `\a \b \f \v` 的跳脫還原把字母換成了控制字元（`\a` 在正則裡是 BEL）。
 *
 * 逐個替換，並**把每一處的前後文印出來**：判定靠的是上下文（`_dditionalProperties`
 * 只可能是 `additionalProperties`），不是靠猜字母。
 *
 * 用 latin1 讀寫 —— 這樣非 ASCII 的中文字節原樣進出，不會被重新編碼。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const P = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher/tools/PRD_MiniProgram_API_Contract_Gap_Scanner.md';
const MAP = { 0x07: 'a', 0x08: 'b', 0x0b: 'v', 0x0c: 'f' };
const RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

const src = readFileSync(P, 'latin1');
const hits = [...src.matchAll(RE)];
console.log(`  发现 ${hits.length} 个控制字元\n`);

let out = '';
let last = 0;
let n = 0;
for (const m of hits) {
  const code = m[0].charCodeAt(0);
  const letter = MAP[code];
  if (!letter) { console.error(`  ✗ 0x${code.toString(16)} 不在对应表里，停手`); process.exit(1); }
  n++;
  const before = src.slice(Math.max(0, m.index - 34), m.index);
  const after = src.slice(m.index + 1, m.index + 22);
  // 只印 ASCII 部分，免得中文在 latin1 下变乱码干扰判断
  const ascii = (s) => s.replace(/[^\x20-\x7e]/g, '·');
  console.log(`  ${String(n).padStart(2)}. 0x${code.toString(16).padStart(2, '0')}→${letter}   ${ascii(before)}【?】${ascii(after)}`);
  out += src.slice(last, m.index) + letter;
  last = m.index + 1;
}
out += src.slice(last);

const back = out;
const left = (back.match(RE) ?? []).length;
console.log(`\n  替换后剩余控制字元: ${left}`);

// 逐个核：替换后的标识符应该是合法名字
const SHOULD = ['additionalProperties', 'ancestorHasTap', 'action', 'bindtap', 'form', 'value'];
console.log(`\n  核这些名字现在拼得出来吗:`);
for (const w of SHOULD) console.log(`    ${back.includes(w) ? '✓' : '✗'} ${w}`);

// 长度核对：13 处一换一，长度必须一模一样
console.log(`\n  长度: ${src.length} → ${back.length}（${src.length === back.length ? '✓ 一换一，没有增删' : '✗ 变了！停手'}）`);
if (src.length !== back.length) process.exit(1);

writeFileSync(P, back, 'latin1');
console.log(`\n  ✓ 已写回 ${P}`);
