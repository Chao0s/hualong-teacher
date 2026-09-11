/**
 * 逐页渲染取字（3 屏样板）。
 *
 * 为什么要它：教师端 56 屏**一屏都渲染不出来**，所以「这一屏长对了没有」谁也答不了。
 * 十步闸门（`npm test`）、15 支探针、`scan:wiring` **全部查不出渲染问题** —— CLAUDE.md §6
 * 最后一行写着「上面全部查不出来」。这一支补的就是那一格。
 *
 * 先说清楚它做不到什么：**挂不进 CI。** 它要微信开发者工具，而工具要 GUI 与扫码登录，
 * GitHub Actions 上跑不起来。所以「每页截图」只能是本机能力。
 *
 * **不用手工打开 IDE。** `automator.launch()` 不停在旁边等一个已开的窗口 —— 它自己把 IDE
 * 起起来。做法是拼一条 CLI 命令（读 `miniprogram-automator/out/Launcher.js` 得到）：
 *
 *     cli.bat auto --project <工程路径> --auto-port <端口> --trust-project
 *
 * 于是 `auto` 子命令拉起 IDE 并开出自动化端口，人在旁边什么都不用点。
 * 两个仍然只能人做一次的：**扫码登录**，以及安装本身。
 * 源码里另有 `--ticket` 与 `--auto-account` 两个参数 —— 那条路能免扫码，
 * 但 ticket 本身要从一个**已登录的 IDE** 里取，所以第一步还是人。
 *
 * 跑之前的两件事：
 *   1. 装微信开发者工具（官方下载）。`miniprogram-automator` 已在 package.json 的
 *      devDependencies 里，但**没装** —— 先 `npm i`。
 *   2. 后端要活着：`cd ../hualong-backend/db/testdata && node server/server.mjs`（3860）。
 *
 * 用法：
 *   node tools/render-pages.mjs                     # 3 屏样板
 *   node tools/render-pages.mjs --all               # 全部 56 屏（样板通了再铺）
 *   node tools/render-pages.mjs --page=home         # 只跑一屏
 *   WX_DEVTOOLS_CLI=<路径> node tools/render-pages.mjs   # 工具不在默认位置时
 */
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..', 'miniprogram');
const OUT = join(HERE, '..', '.scratch', 'render');

// 工具 CLI 的常见位置。找不到就报清楚，不要静默跳过。
const CLI_CANDIDATES = [
  process.env.WX_DEVTOOLS_CLI,
  'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'C:/Program Files/Tencent/微信web开发者工具/cli.bat',
  join(process.env.LOCALAPPDATA ?? '', '微信开发者工具', 'cli.bat'),
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
].filter(Boolean);

const findCli = () => CLI_CANDIDATES.find((p) => existsSync(p));

// app.json 是页面清单的权威（CLAUDE.md §3）。不自己拼目录名。
const allPages = () => {
  const app = JSON.parse(readFileSync(join(PROJECT, 'app.json'), 'utf8'));
  return app.pages.map((p) => '/' + p);
};

// 每屏要取的「能证明它渲染出来了」的东西：几个关键元素 + 一张截图。
// 选择器是**对着各页 index.wxml 核过存在**的（2026-09-12），不是猜的。
// 某屏改了结构，这一行要跟着改 —— 那正是它的用处。
const SAMPLE = {
  '/pages/login/index': { label: '登录', selectors: ['.page', '.btn', '.intro__title'] },
  '/pages/home/index': { label: '首页', selectors: ['.page', '.banner__title', '.quick-grid'] },
  '/pages/growth-book/index': { label: '成长册', selectors: ['.page', '.book-table', '.bar'] },
};

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith('--page='))?.split('=')[1];
const wantAll = argv.includes('--all');

const pick = () => {
  const all = allPages();
  if (only) {
    const hit = all.find((p) => p.includes(only));
    if (!hit) { console.error(`没有哪一页路径里含「${only}」。目录名要对上 app.json。`); process.exit(2); }
    return [hit];
  }
  if (wantAll) return all;
  return Object.keys(SAMPLE);
};

const target = pick();

let automator;
try {
  automator = (await import('miniprogram-automator')).default;
} catch {
  console.error('缺少 miniprogram-automator。它声明在 package.json 的 devDependencies 里但没装：\n  npm i');
  console.error('（在 Google Drive 路径上 npm 写文件会坏，见 CLAUDE.md §7.9。）');
  process.exit(2);
}

const cliPath = findCli();
if (!cliPath) {
  console.error('找不到微信开发者工具的 CLI。查过这些位置：');
  for (const p of CLI_CANDIDATES) console.error('  ' + p);
  console.error('\n装好工具后，或把路径给进来：WX_DEVTOOLS_CLI=<路径> node tools/render-pages.mjs');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
console.log(`工具: ${cliPath}`);
console.log(`工程: ${PROJECT}`);
console.log(`要跑 ${target.length} 屏，截图写到 ${OUT}\n`);

const miniProgram = await automator.launch({ cliPath, projectPath: PROJECT, trustProject: true });

let ok = 0;
const bad = [];
for (const route of target) {
  const spec = SAMPLE[route] ?? { label: route, selectors: [] };
  try {
    const page = await miniProgram.reLaunch(route);
    await page.waitFor(800);

    const found = [];
    for (const sel of spec.selectors) {
      const el = await page.$(sel);
      if (!el) { found.push(`${sel}=✗`); continue; }
      const text = ((await el.text()) ?? '').replace(/\s+/g, ' ').trim();
      found.push(`${sel}=${text ? `「${text.slice(0, 40)}」` : '(空)'}`);
    }

    // 页面自己的 data 也要看 —— 元素找得到不等于数据到了。
    const data = await page.data();
    const shot = join(OUT, route.replace(/[/]/g, '_') + '.png');
    await miniProgram.screenshot({ path: shot });

    console.log(`✓ ${route}（${spec.label}）`);
    console.log(`   元素: ${found.join('  ') || '(这一屏没配选择器)'}`);
    console.log(`   data 键: ${Object.keys(data).slice(0, 12).join(', ')}`);
    console.log(`   截图: ${shot}`);
    ok++;
  } catch (err) {
    bad.push({ route, err: String(err.message ?? err).slice(0, 160) });
    console.log(`✗ ${route} —— ${String(err.message ?? err).slice(0, 160)}`);
  }
}

await miniProgram.close();

console.log(`\n跑通 ${ok} 屏，失败 ${bad.length} 屏。`);
if (bad.length) {
  console.log('\n失败的屏：');
  for (const b of bad) console.log(`  ${b.route}\n    ${b.err}`);
  process.exit(1);
}
