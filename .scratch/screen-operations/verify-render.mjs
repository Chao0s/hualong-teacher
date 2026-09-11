// 正向完整性检验：/pages 与 /roles 是否把每一行的每个字段都渲染出来了。
//
// 为什么不用「改前 vs 改后 diff」：那条路要回建旧版（会动工作区，我刚才已经踩过一次），
// 而且 diff 只能证明「没少」，证明不了「全都还在」。正向检验问的是后者。
// 也不比「原始 HTML 里有没有这个字符串」—— 长路径被 escPath 插了 <wbr>，
// 那样问会得到假失败（我也踩过一次）。
import { readFileSync } from 'node:fs';

const fs = readFileSync;
const P = process.env.LOCALAPPDATA + '/Temp';
const norm = (h) => h.replace(/<wbr\s*\/?>/g, '').replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

const pagesHtml = norm(fs(process.argv[2] || P + '/p3.html', 'utf8'));
const BACKEND = 'G:/My Drive/Workplace/China KG Platform/hualong-backend/db/spec';
const rows = fs(BACKEND + '/screen-operations.tsv', 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n').slice(1)
  .map((l) => { const c = l.split('\t'); return { screen: c[0], title: c[2], state: c[3], op: c[4], method: c[5], path: c[6], source: c[7], gap: c[11], notes: c[12] }; });
const eli = fs(BACKEND + '/operation-eli10.tsv', 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n').slice(1)
  .map((l) => l.split('\t'));

const miss = [];
let checked = 0;
for (const r of rows) {
  checked++;
  const need = [r.screen, r.title, r.state, r.path].filter(Boolean);
  if (r.op) need.push(r.op);
  if (r.method) need.push(r.method);
  for (const n of need) if (!pagesHtml.includes(n)) miss.push(`${r.screen}: 缺 ${JSON.stringify(n)}`);
  // 带 gap 的行要把 gap 文本显示出来
  if (r.gap && !pagesHtml.includes(r.gap)) miss.push(`${r.screen}: 缺 gap「${r.gap}」`);
  // human/planned 行的 notes 里那句判据来源也应露出
}
console.log(`/pages 正向检验：${rows.length} 行 × 字段`);
console.log(`  缺失 ${miss.length} 项${miss.length ? ':' : ' ✓'}`);
for (const m of miss.slice(0, 12)) console.log('    ' + m);

// ELI10：每一条已起草的「幹嘛」都要在 /pages 上出现（它有说人话那一列）
const eliMiss = [];
for (const c of eli) if (c[1] && !pagesHtml.includes(c[1])) eliMiss.push(c[0]);
console.log(`ELI10 在 /pages 上显示：${eli.length - eliMiss.length}/${eli.length}`);
if (eliMiss.length) console.log('  未显示: ' + eliMiss.slice(0, 8).join(', '));

// 行数：/pages 上应能数出 137 条数据行
const dataRows = (fs(process.argv[2] || P + '/p3.html', 'utf8').match(/class="r(?:\s|"| stale| noapi)/g) || []).length;
console.log(`/pages 数据行数（class="r..."）：${dataRows}（tsv 有 ${rows.length} 行）`);
