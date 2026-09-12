// 标签平衡检查：/pages 这一份 HTML 有没有没闭合的标签（regex 检查看不出来的那一类坏）。
// 只读 .scratch/pages-after.html。
import { readFileSync } from 'node:fs';

const h = readFileSync('.scratch/pages-after.html', 'utf8');
const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'wbr', 'source', 'col']);
const TAGS = ['html', 'head', 'body', 'nav', 'section', 'header', 'div', 'p', 'table', 'thead', 'tbody',
  'tr', 'td', 'th', 'article', 'details', 'summary', 'pre', 'select', 'option', 'span', 'code', 'b', 'i',
  'label', 'a', 'button', 'input', 'style', 'script'];
let bad = 0;
for (const t of TAGS) {
  const open = (h.match(new RegExp(`<${t}(?=[\\s>/])`, 'g')) || []).length;
  const close = (h.match(new RegExp(`</${t}>`, 'g')) || []).length;
  const balanced = VOID.has(t) ? close === 0 : open === close;
  if (!balanced) bad++;
  console.log(`  ${t.padEnd(9)} open ${String(open).padStart(5)}  close ${String(close).padStart(5)}  ${balanced ? '' : '<== 不平衡'}`);
}
console.log(`  doctype 在最前：${/^<!doctype html>/.test(h.trim())}`);
console.log(`  </html> 在最末：${/<\/html>\s*$/.test(h)}`);
console.log(`  不平衡的标签：${bad} 种`);
process.exit(bad ? 1 : 0);
