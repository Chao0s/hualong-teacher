// 要求 C 的实测：每一行（屏幕行 / API 行 / 意圖行 / 发现）都要有一个看得见的链接。
// 只读 .scratch/pages-after.html。
import { readFileSync } from 'node:fs';

const h = readFileSync('.scratch/pages-after.html', 'utf8');
const rows = [...h.matchAll(/<(?:tr|div) class="(?:vtr|vrow)" data-key="([^"]+)">([\s\S]*?)<\/(?:tr|div)>/g)]
  .map((m) => ({ key: m[1], html: m[2] }));
console.log(`可控行（一件结论 + 一个保存钮的行）共 ${rows.length}`);
const linkless = rows.filter((r) => !/<a /.test(r.html));
console.log(`其中没有链接的：${linkless.length}`);
for (const r of linkless) {
  const kind = r.key.split(':')[0];
  console.log(`  · ${kind.padEnd(8)} ${r.key}`);
}
const byKind = {};
for (const r of rows) {
  const k = r.key.split(':')[0];
  byKind[k] = byKind[k] || { n: 0, link: 0 };
  byKind[k].n++; if (/<a /.test(r.html)) byKind[k].link++;
}
console.log('\n按行种：');
for (const [k, v] of Object.entries(byKind)) console.log(`  ${k.padEnd(8)} ${v.link}/${v.n} 行带链接`);
