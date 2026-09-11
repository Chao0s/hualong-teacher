/**
 * 逐页渲染取字（3 屏样板）。
 *
 * 为什么要它：教师端 56 屏**一屏都渲染不出来**，所以「这一屏长对了没有」谁也答不了。
 * 十步闸门（`npm test`）、15 支探针、`scan:wiring` **全部查不出渲染问题** —— CLAUDE.md §6
 * 最后一行写着「上面全部查不出来」。这一支补的就是那一格。
 *
 * ── 两条硬约束，都是 2026-09-12 实测出来的 ──────────────────────────────────
 *
 * **① `automator.launch()` 在 Node 20+ 的 Windows 上永远起不来。**
 * 它内部是 `child_process.spawn(cliPath, args, {stdio:'ignore'})`（Launcher.js:40），
 * 而 Node 20 起**不允许不带 shell 直接起 `.bat`/`.cmd`** → `EINVAL`。
 * 同一个文件第 27 行还明确拒绝 `.exe`（"cliPath is not correct, it's usually named as
 * 'cli' or 'cli.bat'"）。所以 0.12.1 这条命令没有一个可用的 cliPath。
 * 办法：**自己把 IDE 起起来，再用 `automator.connect()` 连上去。**
 *
 * **② 开发者工具的「服务端口」必须开着。** 不开时它自己会说：
 *     [error] 工具的服务端口已关闭。要使用命令行调用工具，请手动打开
 *             工具 -> 设置 -> 安全设置，将服务端口开启。
 * 命令行调用就是这个「服务端口」。**实测：这条只能在设置里开一次。**
 * 它虽然提示「enter y to confirm enabling CLI capability」，但那个 y 是从**控制台**读的 ——
 * 把 y 写进管道喂不进去（2026-09-12 试过两次：等提示再喂、启动瞬间喂，它都直接退出）。
 * 所以本脚本不喂 y，也不假装能替你开：连不上时把那句原话打出来，告诉你去哪一格开。
 *
 * **③ 命令行不能靠 shell 自己拼。** `spawn(cmd, args, {shell:true})` 不会给含空格的路径
 * 加引号，而这个工程在 `My Drive` 与 `China KG Platform` 两层空格之下 —— 拼错了
 * 会报 `operable program or batch file`。所以下面自己拼带引号的整串。
 *
 * 做不到什么：**挂不进 CI。** 它要微信开发者工具，而工具要 GUI 与扫码登录，
 * GitHub Actions 上跑不起来。所以「每页截图」只能是本机能力。
 *
 * 用法：
 *   node tools/render-pages.mjs                     # 3 屏样板
 *   node tools/render-pages.mjs --all               # 全部
 *   node tools/render-pages.mjs --page=home         # 只跑一屏
 *   WX_DEVTOOLS_CLI=<路径> node tools/render-pages.mjs
 *   WX_AUTO_PORT=9420                                # 自动化端口，默认 9420
 */
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..', 'miniprogram');
const OUT = join(HERE, '..', '.scratch', 'render');
const AUTO_PORT = Number(process.env.WX_AUTO_PORT ?? 9420);

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
  return wantAll ? all : Object.keys(SAMPLE);
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

// ── 自己起 IDE（不吃 automator.launch 那个 EINVAL）─────────────────────────
// 自己拼带引号的整串：路径里有空格，shell 不会替你加。
const cmdline = `"${cliPath}" auto --project "${PROJECT}" --auto-port ${AUTO_PORT} --trust-project`;
console.log('起 IDE ...');
const ide = spawn(cmdline, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let ideOut = '';
const collect = (d) => { ideOut += String(d); };
ide.stdout.on('data', collect);
ide.stderr.on('data', collect);
ide.on('error', (e) => console.error('  起 IDE 失败:', e.code ?? e.message));

// 等自动化端口开
let mp = null;
for (let i = 1; i <= 30; i++) {
  await sleep(2000);
  try {
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` });
    console.log(`  连上（第 ${i} 次，约 ${i * 2}s）\n`);
    break;
  } catch { /* 还没开，继续等 */ }
}

if (!mp) {
  console.error('连不上自动化端口 —— IDE 没起来，或「服务端口」没开。');
  if (/服务端口已关闭|service port disabled/i.test(ideOut)) {
    console.error('  IDE 的原话：');
    for (const l of ideOut.split('\n').filter((l) => /服务端口|service port|安全设置|Settings/i.test(l)).slice(0, 4)) {
      console.error('    ' + l.trim());
    }
    console.error('  去打开一次：工具 -> 设置 -> 安全设置 -> 服务端口。');
  } else if (ideOut) {
    console.error('  IDE 输出：\n' + ideOut.split('\n').slice(-8).join('\n'));
  } else {
    console.error('  IDE 一个字都没输出 —— 命令没起来。');
  }
  try { ide.kill(); } catch { /* 已经没了 */ }
  process.exit(1);
}

let ok = 0;
const bad = [];
for (const route of target) {
  const spec = SAMPLE[route] ?? { label: route, selectors: [] };
  try {
    const page = await mp.reLaunch(route);
    await sleep(900);

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
    await mp.screenshot({ path: shot });

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

try { await mp.close(); } catch { /* 已关 */ }
try { ide.kill(); } catch { /* 已退 */ }

console.log(`\n跑通 ${ok} 屏，失败 ${bad.length} 屏。`);
if (bad.length) {
  console.log('\n失败的屏：');
  for (const b of bad) console.log(`  ${b.route}\n    ${b.err}`);
  process.exit(1);
}
