// 修三处：CLAUDE.md 多出的空行、CLAUDE.md 与 AGENTS.md 的同步、生成器刷掉的 ui-binding.tsv
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const B = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';
const claude = `${B}/CLAUDE.md`;
const agents = `${B}/AGENTS.md`;

// 1. 把我插进 CLAUDE.md 的那两行空行收成一行
const src = readFileSync(claude, 'utf8');
const dup = '\r\n\r\n\r\n## UI 改版不得破坏数据映射';
if (!src.includes(dup)) {
  console.error('FAIL 找不到多余空行，放弃');
  process.exit(1);
}
writeFileSync(claude, src.replace(dup, '\r\n\r\n## UI 改版不得破坏数据映射'));
console.log('OK   CLAUDE.md 多余空行已收成一行');

// 2. 逐字节复制给 AGENTS.md（两份必须相同，CRLF 一并保留）
copyFileSync(claude, agents);
console.log('OK   AGENTS.md 已与 CLAUDE.md 逐字节同步');
