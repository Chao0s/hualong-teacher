// 把 login 那两行的 title_source 补上（那两行是登录页子代理写的，我 steer 不到它 —— 它已经结束了）。
// 值是事实：`screens/login.html` 不存在 → 「原型文件不在」。**不编。**
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'G:/My Drive/Workplace/China KG Platform/hualong-backend/db/spec/screen-operations.tsv';
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const L = readFileSync(F, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
const H = L[0].split('\t');
const iSrc = H.indexOf('title_source');
const iScr = H.indexOf('screen');
if (iSrc < 0) { console.error('表里没有 title_source 列'); process.exit(1); }

let n = 0;
const out = L.slice(1).map((l) => {
  const c = l.split('\t');
  if (c[iScr] === 'login' && !c[iSrc]) { c[iSrc] = '原型文件不在'; n++; }
  return c.join('\t');
});
writeFileSync(F, crlf(`${[H.join('\t'), ...out].join('\n')}\n`));
console.log(`补了 ${n} 行（login）的 title_source = 原型文件不在`);
