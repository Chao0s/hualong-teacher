// 负向测试：把 guard 的跳转与 return true 拿掉（回到上一版的样子），看夹具的 H 组会不会红。
// 用 node 改而不是 sed —— 这几行是 CRLF，sed 的锚点很容易不匹配（上一次就没匹配上）。
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher/miniprogram/utils/guard.js';
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const mode = process.argv[2];
const t = readFileSync(F, 'utf8').replace(/\r\n/g, '\n');

if (mode === 'break') {
  const from = "  wx.reLaunch({ url: '/pages/login/index' });\n  return true;";
  if (!t.includes(from)) { console.error('找不到要替换的两行'); process.exit(1); }
  writeFileSync(F, crlf(t.replace(from, '  // 负向测试：跳转与 return true 被拿掉')));
  console.log('已破坏');
} else if (mode === 'restore') {
  const from = "  // 负向测试：跳转与 return true 被拿掉";
  if (!t.includes(from)) { console.error('找不到被破坏的那行'); process.exit(1); }
  writeFileSync(F, crlf(t.replace(from, "  wx.reLaunch({ url: '/pages/login/index' });\n  return true;")));
  console.log('已还原');
}
