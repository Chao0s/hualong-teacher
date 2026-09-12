/**
 * 端到端：連上 → 截圖 → 落地成檔 → 報大小。
 *
 * 判據：拿到非空的圖檔，而且它真的是 PNG（看魔數 \x89PNG）。
 * 只看「函式回傳了東西」不算 —— 空圖或錯誤頁也是「有回傳」。
 */
import { Automator } from '@weapp-vite/miniprogram-automator';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const port = Number(process.argv[2] ?? 9420);
const route = process.argv[3] ?? '/pages/login/index';
const outDir = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher/.scratch/render';
mkdirSync(outDir, { recursive: true });

const mp = await new Automator().connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
console.log('  ✓ 已连上');

// 导航到目标页
try {
  const p = await mp.reLaunch(route);
  console.log(`  ✓ reLaunch ${route} → ${p?.path ?? '(无 path)'}`);
} catch (e) {
  console.log(`  ✗ reLaunch 抛错: ${String(e.message).slice(0, 140)}`);
}

// 给渲染一点时间
await new Promise((r) => setTimeout(r, 2500));

// 问现在在哪一页
try {
  const cur = await mp.currentPage();
  console.log(`  当前页: ${cur?.path ?? 'null'}`);
} catch (e) {
  console.log(`  ✗ currentPage 抛错: ${String(e.message).slice(0, 120)}`);
}

// 截图
let shot = null;
try {
  shot = await mp.screenshot({});
  console.log(`  screenshot 回传类型: ${typeof shot}`);
} catch (e) {
  console.log(`  ✗ screenshot 抛错: ${String(e.message).slice(0, 160)}`);
}

if (shot) {
  const name = route.replace(/\//g, '_').replace(/^_/, '') || 'shot';
  const file = `${outDir}/${name}.png`;
  let buf;
  if (typeof shot === 'string') {
    // 可能是 base64 或 data URL
    const b64 = shot.includes(',') ? shot.split(',')[1] : shot;
    buf = Buffer.from(b64, 'base64');
  } else {
    buf = Buffer.from(shot);
  }
  writeFileSync(file, buf);
  const back = readFileSync(file);
  const isPng = back[0] === 0x89 && back[1] === 0x50 && back[2] === 0x4e && back[3] === 0x47;
  console.log(`  写到 ${file}`);
  console.log(`  大小 ${back.length} 字节  是 PNG: ${isPng ? '✓' : '✗'}`);
}

await mp.disconnect().catch(() => {});
