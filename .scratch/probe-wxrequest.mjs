/**
 * 登入卡住的決定性問題：**請求發得出去嗎？**
 *
 * 做法：不碰任何共享服務端，改從**小程序自己的執行環境**發一次 `wx.request`。
 * 這樣能把兩種情況分開：
 *   ① 發不出去 —— 小程序的網路層拒絕/排除了這個位址 → callWxMethod 直接回 fail
 *   ② 發出且回了 —— 那卡住的原因在客戶端流程，不在網路
 *   ③ 發出去但不回 —— 那就是服務端或連線的問題
 *
 * 附就緒閘門：連上不等於工程載入完（今天為此 56 屏全紅過一次）。
 */
import { Automator } from '@weapp-vite/miniprogram-automator';

const port = Number(process.argv[2] ?? 9420);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mp = await new Automator().connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
console.log('  ✓ 已连上');

// 就绪闸门
let ready = false;
for (let i = 1; i <= 20; i++) {
  try {
    const p = await mp.currentPage();
    if (p?.path) { ready = true; console.log(`  ✓ 工程就绪（第 ${i} 次探测）—— 停在 ${p.path}`); break; }
  } catch { /* 还没好 */ }
  await sleep(2000);
}
if (!ready) { console.log('  ✗ 工程一直没载入出页面'); process.exit(1); }

const BASE = 'http://127.0.0.1:3860/api/v1';

// ① 小程序能不能发出去并拿到回包
console.log('\n  ── 从小程序运行时发 POST /dev/session ──');
try {
  const res = await mp.callWxMethod('request', {
    url: `${BASE}/dev/session`,
    method: 'POST',
    data: { surface: 'teacher', subject_id: 1 },
    header: { 'content-type': 'application/json' },
    timeout: 8000,
  });
  const r = res?.result ?? res;
  console.log(`  回包 statusCode: ${r?.statusCode ?? '(无)'}`);
  const body = typeof r?.data === 'string' ? r.data : JSON.stringify(r?.data ?? null);
  console.log(`  回包 body 前 160 字: ${String(body).slice(0, 160)}`);
} catch (e) {
  console.log(`  ✗ 抛错/失败: ${String(e.message ?? e).slice(0, 200)}`);
}

// ② 顺手看看 config 里那个 baseUrl 是不是同一个
try {
  const cfg = await mp.evaluate(() => {
    const c = require('./config.js');
    return { surface: c.SURFACE, baseUrl: c.env && c.env.baseUrl, devSession: c.env && c.env.devSession, devSubjectId: c.devSubjectId };
  });
  console.log(`\n  ── 小程序自己的 config ──`);
  console.log(`  ${JSON.stringify(cfg)}`);
} catch (e) {
  console.log(`\n  （读 config 失败，不影响上面那问：${String(e.message).slice(0, 100)}）`);
}

// **不呼叫 mp.close()** —— 它会把自动化会话关掉，下一次跑就得重建。
// 会话是共享资源，临时探针只该断开连接，不该关掉服务。
try { await mp.disconnect(); } catch { /* 新版 disconnect 是同步的，返回 void */ }
