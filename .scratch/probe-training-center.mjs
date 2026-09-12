/**
 * 驗 `training-center` 接線後畫的是真資料。
 *
 * 判據不是「有東西畫出來」——是**畫的是庫裡的真資料**。
 * 庫裡現有的資源名：祠堂里的故事、醒狮图谱、龙舟结构图…（見 db_resource）。
 * 接線前這一屏畫的是寫死的「沙湾留耕堂 · 祠堂空间」。
 */
import { Automator } from '@weapp-vite/miniprogram-automator';

const mp = await new Automator().connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
await mp.reLaunch('/pages/training-center/index');
await new Promise((r) => setTimeout(r, 3000));

const page = await mp.currentPage();
console.log(`  currentPage: ${page?.path ?? '(取不到)'}`);

const d = await page.data();
console.log(`  loading: ${d.loading}   error: ${JSON.stringify(d.error)}`);
console.log(`  banners: ${d.banners?.length ?? '(无)'}  resources: ${d.resources?.length ?? '(无)'}  cases: ${d.cases?.length ?? '(无)'}`);

if (d.banners?.length) console.log(`  第一个轮播: ${JSON.stringify(d.banners[0])}`);
if (d.resources?.length) console.log(`  第一个推荐资源: ${JSON.stringify(d.resources[0])}`);
if (d.cases?.length) console.log(`  第一个推荐案例: ${JSON.stringify(d.cases[0])}`);

// 屏上的字 —— 写死的「沙湾留耕堂」应该消失，换成库里的名字
const wxml = String(await page.wxml());
const text = wxml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
console.log(`\n  屏上文字（前 300）: ${text.slice(0, 300)}`);
console.log(`\n  含写死的「沙湾留耕堂」: ${/沙湾留耕堂/.test(text) ? '✗ 还在（没接上）' : '✓ 已消失'}`);

try { mp.disconnect(); } catch { /* 同步 */ }
