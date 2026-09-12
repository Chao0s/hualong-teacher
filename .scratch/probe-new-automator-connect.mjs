/**
 * 用 @weapp-vite/miniprogram-automator（1.2.17，2026-09-10 發版）
 * 問跟官方 0.12.1 **完全相同的一組問題**。
 *
 * 判據：若官方的 rawPath 錯誤消失、且頁面棧 ≥ 1，那麼牆是「套件太舊」，不是別的。
 */
import { Automator } from '@weapp-vite/miniprogram-automator';

const port = Number(process.argv[2] ?? 9420);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const automator = new Automator();

let mp = null;
for (let i = 1; i <= 15; i++) {
  try {
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
    console.log(`  ✓ 连上（第 ${i} 次，约 ${i * 2}s）`);
    break;
  } catch (e) {
    if (i === 15) console.log(`  ✗ 连不上: ${String(e.message).slice(0, 140)}`);
    await sleep(2000);
  }
}
if (!mp) process.exit(1);

try {
  const stack = await mp.pageStack();
  console.log(`  页面栈: ${stack.length} 层  ${stack.map((p) => p.path).join(', ')}`);
} catch (e) {
  console.log(`  ✗ pageStack 抛错: ${String(e.message).slice(0, 160)}`);
}

try {
  const page = await mp.currentPage();
  console.log(`  currentPage → ${page ? page.path : 'null'}`);
  if (page) {
    const el = await page.$('page');
    console.log(`  根元素 page：${el ? '拿得到' : '拿不到'}`);
    const data = await page.data();
    console.log(`  page.data() 的键: ${Object.keys(data ?? {}).slice(0, 10).join(', ') || '(空)'}`);
  }
} catch (e) {
  console.log(`  ✗ currentPage 抛错: ${String(e.message).slice(0, 160)}`);
}

try { await mp.disconnect(); } catch { /* 新版是同步的 disconnect */ }
