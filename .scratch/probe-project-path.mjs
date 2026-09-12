/**
 * 驗一個假設：render-pages.mjs 把 --project 指錯地方。
 *
 * 它傳 `<倉根>/miniprogram`，而 project.config.json 在**倉根**
 * （裏面 miniprogramRoot: "miniprogram/"）。IDE 開一個沒有設定的目錄，
 * 就沒有 AppID、沒有編譯出的頁面，於是 getPageMetaByWebviewId 回 null —— 
 * 表現得跟「automator 協議不符」一模一樣。
 *
 * 這個探針連到指定的自動化埠，只做一件最基本的事：問「現在是哪一頁」。
 * 若回得出頁面路徑，假設成立（工程載入成功）。
 */
import automator from 'miniprogram-automator';

const port = Number(process.argv[2] ?? 9421);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mp = null;
for (let i = 1; i <= 20; i++) {
  try {
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
    console.log(`  ✓ 连上（第 ${i} 次，约 ${i * 2}s）`);
    break;
  } catch (e) {
    await sleep(2000);
  }
}
if (!mp) { console.log('  ✗ 连不上 —— IDE 没起来或服务端口没开'); process.exit(1); }

// ① 最基本的一问：现在有页面吗
try {
  const page = await mp.currentPage();
  if (page) {
    console.log(`  ✓ currentPage → ${page.path}`);
  } else {
    console.log('  ✗ currentPage 回 null —— **工程没有载入任何页面**');
  }
} catch (e) {
  console.log(`  ✗ currentPage 抛错: ${String(e.message).slice(0, 160)}`);
}

// ② 页面栈有几层
try {
  const stack = await mp.pageStack();
  console.log(`  页面栈: ${stack.length} 层  ${stack.map((p) => p.path).join(', ')}`);
} catch (e) {
  console.log(`  ✗ pageStack 抛错: ${String(e.message).slice(0, 120)}`);
}

// ③ 拿当前页的 wxml（真载入的话这里拿得到东西）
try {
  const page = await mp.currentPage();
  if (page) {
    const el = await page.$('page');
    console.log(`  根元素 page: ${el ? '拿得到' : '拿不到'}`);
    const data = await page.data();
    console.log(`  page.data() 的键: ${Object.keys(data ?? {}).slice(0, 8).join(', ') || '(空)'}`);
  }
} catch (e) {
  console.log(`  ✗ 读页面内容抛错: ${String(e.message).slice(0, 160)}`);
}

await mp.disconnect().catch(() => {});
