// 看 @weapp-vite/miniprogram-automator 匯出什麼（connect 在哪一層）
const m = await import('@weapp-vite/miniprogram-automator');
console.log('  模組匯出的鍵:', Object.keys(m).join(', '));

const d = m.default;
console.log('  default 的型別:', typeof d);
if (d && typeof d === 'object') {
  console.log('  default 的鍵:', Object.keys(d).join(', '));
}

for (const [label, obj] of [['default', d], ['模組', m]]) {
  if (!obj) continue;
  for (const k of ['connect', 'launch', 'MiniProgram', 'Page', 'Element']) {
    if (typeof obj[k] === 'function') console.log(`  ✓ ${label}.${k} 是函式`);
  }
}
