// 把 §7.7 插进 hualong-teacher/CLAUDE.md 的「会咬人的地方」，按 CRLF 落盘。
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher/CLAUDE.md';
const ADD = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher/.scratch/screen-operations/claude-7.7.md';

const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const before = read(FILE);
const add = read(ADD);

// 插在 §8 之前（7.6 结尾与 §8 之间隔着一条 `---`）
const anchor = '\n## 8. 开工前必读';
const at = before.indexOf(anchor);
if (at < 0) { console.error('FAIL 找不到 §8 锚点'); process.exit(1); }
if (!before.includes('### 7.6 断言形状 ≠ 断言值')) { console.error('FAIL 找不到 7.6'); process.exit(1); }

const after = `${before.slice(0, at)}\n${add}${before.slice(at + 1)}`;

if (!after.includes('### 7.7 ELI10 不在契约里')) { console.error('FAIL 7.7 没进去'); process.exit(1); }
if (!after.includes('## 8. 开工前必读')) { console.error('FAIL §8 丢了'); process.exit(1); }
if (!after.includes('### 7.6 断言形状 ≠ 断言值')) { console.error('FAIL 7.6 丢了'); process.exit(1); }

writeFileSync(FILE, crlf(after));
console.log(`OK  ${before.split('\n').length} 行 -> ${after.split('\n').length} 行，孤立 LF ${(after.match(/(?<!\r)\n/g) || []).length}`);
