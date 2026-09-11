// Q3 的前提量测：那 40 行 trigger_flag=只wxml，原型页上到底有没有可对应的按钮文案？
// 如果原型页根本没有按钮（早前 recon 的结论是「多半没有」），那加宽枚举也生不出数据 ——
// 该做的是把「原型根本没有可机读按钮」这件事如实说出来，而不是养一个永远不会触发的分支。
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const tsv = readFileSync(`${REPO}/../hualong-backend/db/spec/screen-operations.tsv`, 'utf8')
  .replace(/\r\n/g, '\n').trimEnd().split('\n').slice(1)
  .map((l) => { const c = l.split('\t'); return { screen: c[0], trigger: c[8], proto: c[9], flag: c[10], op: c[4] }; });

const protoButtons = (name) => {
  const f = `${REPO}/screens/${name}.html`;
  if (!existsSync(f)) return null;
  const html = readFileSync(f, 'utf8');
  const btns = [...html.matchAll(/<button\b[^>]*>([^<]*)/g)].map((m) => (m[1] || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const taps = [...html.matchAll(/(?:btn|entry|card|chip|link|row)[\w-]*["'][^>]*(?:href|data-action)="([^"]*)"/g)].map((m) => m[1]);
  return { buttons: btns, interactive: taps.length, bytes: html.length };
};

const byFlag = {};
for (const r of tsv) (byFlag[r.flag || '(空)'] = byFlag[r.flag || '(空)'] || []).push(r);

console.log('flag 分布:', Object.entries(byFlag).map(([k, v]) => `${k}=${v.length}`).join('  '));
console.log('');

const noTrigger = tsv.filter((r) => !r.trigger).length;
console.log(`trigger_wxml 为空的行: ${noTrigger}/${tsv.length}（没有触发语可对）`);

const screens = [...new Set(tsv.map((r) => r.screen))];
let noProto = 0, noButtons = 0, hasButtons = 0;
const samples = [];
for (const s of screens) {
  const p = protoButtons(s);
  if (!p) { noProto++; continue; }
  if (p.buttons.length === 0) { noButtons++; samples.push(`${s}: 0 个 <button>`); }
  else hasButtons++;
}
console.log(`55 屏的原型: 文件不在 ${noProto} 屏，有文件但 0 个 <button> ${noButtons} 屏，有 <button> ${hasButtons} 屏`);
console.log('零按钮样例:'); for (const s of samples.slice(0, 6)) console.log('  ' + s);

console.log('\n=== 40 行「只wxml」里，原型到底有没有按钮 ===');
const only = byFlag['只wxml'] || [];
const tally = {};
for (const r of only) {
  const p = protoButtons(r.screen);
  const key = p === null ? '原型文件不在' : p.buttons.length === 0 ? '原型有文件但 0 按钮' : `原型有 ${p.buttons.length} 个按钮`;
  tally[key] = (tally[key] || 0) + 1;
}
for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v} 行`);

console.log('\n=== 29 行有 trigger_prototype 的，是不是与 wxml 逐字相同 ===');
const withProto = tsv.filter((r) => r.proto);
const same = withProto.filter((r) => r.proto === r.trigger).length;
console.log(`  逐字相同的 ${same}/${withProto.length}；不同的：`);
for (const r of withProto.filter((x) => x.proto !== x.trigger).slice(0, 6)) console.log(`    wxml="${r.trigger}"  proto="${r.proto}"  flag=${r.flag}`);
