/**
 * 登录页为什么没跳走？把它的 data 整个读出来。
 *
 * 登录页的 data 键（早前探针看到）：loading, needsPhone, failed, quotaStop,
 * quotaStopNote, phoneNote —— **`failed` 就是答案所在**，不要猜。
 */
import { Automator } from '@weapp-vite/miniprogram-automator';

const port = Number(process.argv[2] ?? 9420);
const mp = await new Automator().connect({ wsEndpoint: `ws://127.0.0.1:${port}` });

// 先回首页再回登录页，确保不是被上一次的状态影响
try { await mp.reLaunch('/pages/home/index'); } catch { /* 可能自己跳走 */ }
await new Promise((r) => setTimeout(r, 1500));

let page = null;
try {
  page = await mp.reLaunch('/pages/login/index');
} catch (e) {
  console.log(`  reLaunch 抛错: ${String(e.message).slice(0, 120)}`);
}
await new Promise((r) => setTimeout(r, 4000));

const cur = await mp.currentPage().catch(() => null);
console.log(`  现在在哪一页: ${cur?.path ?? '(取不到)'}`);

if (cur) {
  const d = await cur.data().catch(() => null);
  if (d) {
    console.log('  ── 登录页 data ──');
    for (const k of ['loading', 'needsPhone', 'failed', 'quotaStop', 'quotaStopNote', 'phoneNote']) {
      if (k in d) console.log(`    ${k}: ${JSON.stringify(d[k])?.slice(0, 300)}`);
    }
  }
  // 页面上写的字也读出来 —— data 是原因，文字是证据
  try {
    const wxml = await cur.wxml();
    const text = String(typeof wxml === 'string' ? wxml : JSON.stringify(wxml)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`  屏上文字: ${text.slice(0, 400)}`);
  } catch { /* 取不到 */ }
}

await mp.close().catch(() => {});
