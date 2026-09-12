/**
 * `page.wxml()` 到底能不能用？
 *
 * 為什麼要問：逐頁對照腳本對**每一屏**都報「渲染失敗」，而那些失敗都被
 * try/catch 吞掉了。如果 `wxml()` 根本不可用，那 `render-pages.mjs` 裡的
 * 渲染態檢查就是**默默讀不到 → 回報 0 標記**，那個 0 是假綠。
 *
 * 判據：拿到非空字串才算可用；拿到空或拋錯都要說得出來。
 */
import { Automator } from '@weapp-vite/miniprogram-automator';

const mp = await new Automator().connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
await mp.reLaunch('/pages/home/index');
await new Promise((r) => setTimeout(r, 1500));

const page = await mp.currentPage();
console.log(`  currentPage: ${page?.path ?? '(取不到)'}`);

for (const [label, fn] of [
  ['page.wxml()', () => page.wxml()],
  ['page.data()', () => page.data()],
  ['page.$(\".page\")', () => page.$('.page')],
]) {
  try {
    const v = await fn();
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    console.log(`  ✓ ${label.padEnd(16)} → ${typeof v}  长度 ${s?.length ?? 0}`);
    if (label === 'page.wxml()' && typeof v === 'string') {
      console.log(`      前 300 字: ${v.slice(0, 300).replace(/\s+/g, ' ')}`);
    }
  } catch (e) {
    console.log(`  ✗ ${label.padEnd(16)} 抛错: ${String(e.message ?? e).slice(0, 160)}`);
  }
}

try { mp.disconnect(); } catch { /* 同步 */ }
