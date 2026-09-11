// Q4 的验证：「只原型」= 原型上有东西，而我们映射表里没有任何操作认领它。
// 输入是三组对账的 missing（15 条）。逐条自己核：原型文件里有没有它说的那段、表里有没有那条操作。
import { readFileSync, existsSync } from 'node:fs';
const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const BACKEND = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';

const claimed = JSON.parse(readFileSync(`${REPO}/.scratch/screen-operations/proto-missing-claims.json`, 'utf8'));

const tsv = readFileSync(`${BACKEND}/db/spec/screen-operations.tsv`, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n').slice(1)
  .map((l) => { const c = l.split('\t'); return { screen: c[0], op: c[5], path: c[7], source: c[8], gap: c[12] }; });
const hasOp = (screen, needle) => tsv.some((r) => r.screen === screen && ((r.op || '') + (r.path || '') + (r.gap || '')).includes(needle));
const protoHas = (file, needle) => {
  const f = `${REPO}/${file}`;
  if (!existsSync(f)) return '文件不在';
  const h = readFileSync(f, 'utf8');
  return h.includes(needle) ? '有' : `没有「${needle}」`;
};

let ok = 0, bad = 0;
for (const c of claimed) {
  const inProto = protoHas(c.file, c.needle);
  const inTable = c.tableNeedle ? hasOp(c.screen, c.tableNeedle) : null;
  const verdict = inProto === '有' && inTable === false ? '成立' : '要看';
  if (verdict === '成立') ok++; else bad++;
  console.log(`${verdict === '成立' ? '✓' : '?'} [${c.group}] ${c.screen}  —— ${c.what}`);
  console.log(`     原型 ${c.file}: ${inProto}`);
  if (c.tableNeedle) console.log(`     我的表里「${c.tableNeedle}」: ${inTable ? '有（那就不是缺口）' : '没有'}`);
  console.log(`     子代理的理由: ${String(c.why || '').slice(0, 130)}`);
}
console.log(`\n成立 ${ok}，要看 ${bad}（共 ${claimed.length}）`);
