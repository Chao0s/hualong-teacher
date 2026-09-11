// 那 22 行「只wxml」：原型页有按钮，但归一化后也对不上。看看它们到底对不对得上 ——
// 如果确实有相近的按钮而我漏了，就该让「文案不同」报出来；如果确实无关，就该保持 只wxml。
import { readFileSync } from 'node:fs';
const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const rows = readFileSync(`${REPO}/../hualong-backend/db/spec/screen-operations.tsv`, 'utf8')
  .replace(/\r\n/g, '\n').trimEnd().split('\n').slice(1)
  .map((l) => { const c = l.split('\t'); return { screen: c[0], title: c[2], op: c[4], trigger: c[8], proto: c[9], flag: c[10] }; })
  .filter((r) => r.flag === '只wxml');

const protoButtons = (name) => {
  const f = `${REPO}/screens/${name}.html`;
  try {
    const html = readFileSync(f, 'utf8');
    return [...html.matchAll(/<button\b[^>]*>([^<]*)/g)].map((m) => (m[1] || '').trim()).filter(Boolean);
  } catch { return []; }
};

console.log(`22 行里，逐条看原型那一屏的按钮文案：\n`);
let show = 0;
for (const r of rows) {
  const btns = protoButtons(r.screen);
  const rel = r.trigger ? btns.filter((b) => [...b].some((ch) => r.trigger.includes(ch))) : [];
  console.log(`■ ${r.screen}（${r.title}） op=${r.op || '—'}`);
  console.log(`   wxml 触发语: ${r.trigger ? `「${r.trigger}」` : '（空）'}`);
  console.log(`   原型按钮(${btns.length}): ${btns.slice(0, 8).map((b) => `「${b}」`).join(' ')}${btns.length > 8 ? ' …' : ''}`);
  if (rel.length) console.log(`   ⚠ 有字符重叠: ${rel.map((b) => `「${b}」`).join(' ')}`);
  if (++show >= 10) break;
}
console.log(`\n（只列前 10 条，共 ${rows.length} 条）`);
