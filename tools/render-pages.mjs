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
// **工程根是仓库根，不是 `miniprogram/`。** `project.config.json` 在仓库根，它里面写
// `miniprogramRoot: "miniprogram/"`。传 `miniprogram/` 给 IDE 会开出一个没有设定的目录：
// 没有 AppID（CLI 印 `Using AppID: undefined`）、页面不算载入，于是截图全挂 —— 
// 而症状跟「automator 协议不符」一模一样，很容易误诊。2026-09-12 实测对比过两种路径。
const PROJECT = join(HERE, '..');
/** 程序码所在目录。`app.json` 在这里，而它在 `PROJECT` 下一层。 */
const MP = join(PROJECT, 'miniprogram');
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
  const app = JSON.parse(readFileSync(join(MP, 'app.json'), 'utf8'));
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

// 用 `@weapp-vite/miniprogram-automator`，**不是**官方的 `miniprogram-automator`。
//
// 官方那一版最后一次发版是 2023-11-07（0.12.1），之后没再动。它与本机这版
// DevTools（2.02.2608070）协议不符：`connect()` 连得上，但任何要读页面的调用都抛
//   Cannot destructure property 'rawPath' of 't.getPageMetaByWebviewId(...)' as it is null
// 于是一屏都截不出来。2026-09-12 实测：换成这个替代实现后，同一组调用立刻正常
// （currentPage 回 pages/login/index，screenshot 回一张 28 KB 的合法 PNG）。
//
// 它的 API 是类别，不是顶层函式：new Automator().connect({ wsEndpoint })。
let Automator;
try {
  ({ Automator } = await import('@weapp-vite/miniprogram-automator'));
} catch {
  console.error('缺少 @weapp-vite/miniprogram-automator。装法见 CLAUDE.md §7.9');
  console.error('（Google Drive 路径上 npm 写文件会坏：装在 %LOCALAPPDATA%/Temp 再复制回来）。');
  process.exit(2);
}
const automator = new Automator();

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

// ── 接上 IDE：**埠上有活的就接，没有才起** ────────────────────────────────
//
// 从前每次都 spawn 一个新 IDE，跑完再 `ide.kill()`。于是「跑第二次」会连上
// 上一个**还在关**的 IDE —— 连接建立成功，但此后每一次调用都抛
// `Uncaught [object Object]`，56 屏全红。
//
// 2026-09-12 实测：同一条命令连跑三次，通 1 次、红 2 次，**就因为连上的是正在死的那一个**。
// 这与本仓记过四次的「埠上坐着旧进程」是同一物种：连接成功不等于对象活着。
let mp = null;

try {
  mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` });
  console.log(`  接上了（IDE 已经开着，没另起）\n`);
} catch { /* 埠上没有活会话，自己起一个 */ }

let ide = null;
let ideOut = '';
if (!mp) {
  // 自己拼带引号的整串：路径里有空格，shell 不会替你加。
  const cmdline = `"${cliPath}" auto --project "${PROJECT}" --auto-port ${AUTO_PORT} --trust-project`;
  console.log('起 IDE ...');
  ide = spawn(cmdline, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const collect = (d) => { ideOut += String(d); };
  ide.stdout.on('data', collect);
  ide.stderr.on('data', collect);
  ide.on('error', (e) => console.error('  起 IDE 失败:', e.code ?? e.message));

  for (let i = 1; i <= 30; i++) {
    await sleep(2000);
    try {
      mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` });
      console.log(`  连上（第 ${i} 次，约 ${i * 2}s）\n`);
      break;
    } catch { /* 还没开，继续等 */ }
  }
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
/**
 * 渲染态错误：屏幕画出来了，但画的是「失败」而不是内容。
 *
 * 其他十层都看不见这个 —— 它们查契约、查接线、查库，查不到「屏幕上写着请求失败」。
 * 2026-09-12 第一次跑渲染就撞上：登录页画的是 `网络请求失败: request:fail`，
 * 因为 config.js 指的 3860 上没有服务。**那是真的红，不是杂讯。**
 */
const errors = [];
/**
 * 读不到页面文字的屏。**与 `errors` 分开** —— 那是「读到内容、内容是失败」，
 * 这是「根本没读到」。合成一个数就分不出「0 个错误」与「0 次成功读取」。
 */
const readFail = [];
const ERROR_MARKERS = [/网络请求失败/, /请求失败/, /加载失败/, /request:fail/, /服务器错误/, /系统繁忙/];

/**
 * 已知会自己跳走的屏。
 *
 * 已登录时登录页跳首页（§3），所以它不可能停在页面栈顶 —— `reLaunch` 会抛
 * `page is not on top of page stack`。**那是正确行为，不是缺陷**：
 * 把「跳对了目标」判成通过，别让渲染层永远挂一条假红。
 */
const REDIRECTS = {
  '/pages/login/index': 'pages/home/index',
};

/**
 * 就绪闸门：**连上不等于工程载入完。**
 *
 * 冷启动时 DevTools 自己还在起，此时 `connect` 已经成功，但每一次导航都失败 ——
 * 56 屏全红，而错误只是一个 `Uncaught [object Object]`，看不出是「还没好」。
 * 2026-09-12 实测：`quit` 之后冷跑 = 0/56；IDE 暖着再跑 = 56/56，同一份代码。
 *
 * 判据不是「连上了」，而是「问得出当前是哪一页」。
 */
let ready = false;
for (let i = 1; i <= 30; i++) {
  try {
    const p = await mp.currentPage();
    if (p?.path) { ready = true; console.log(`  工程就绪（第 ${i} 次探测，约 ${i * 2}s）\n`); break; }
  } catch { /* 还没载入完，继续等 */ }
  await sleep(2000);
}
if (!ready) {
  console.error('连上了自动化埠，但工程一直没载入出页面 —— 30 次探测都没拿到 currentPage。');
  console.error('  常见原因：AppID 不对（看 CLI 印的是 Using AppID: 什么），或工程有编译错误。');
  try { await mp.close(); } catch { /* 已关 */ }
  process.exit(1);
}

for (const route of target) {
  const spec = SAMPLE[route] ?? { label: route, selectors: [] };
  try {
    const page = await mp.reLaunch(route);
    await sleep(900);

    // `reLaunch` 之后**回看实际停在哪一页**：有的屏会立刻把自己换掉（已登录时登录页
    // 跳首页，§3），此时 `reLaunch` 回的那个 page 物件已经作废，在它上面 `$()`／`data()`
    // 会抛 `page is not on top of page stack`。判据是「跳对了目标」，不是「停在原地」。
    const want = REDIRECTS[route];
    if (want) {
      const actual = await mp.currentPage().catch(() => null);
      if (actual?.path === want) {
        console.log(`✓ ${route}（${spec.label}）—— 自行跳到 ${actual.path}，符合预期`);
        ok++;
        continue;
      }
      bad.push({ route, err: `应跳到 ${want}，实际停在 ${actual?.path ?? '(取不到)'}` });
      console.log(`✗ ${route} —— 应跳到 ${want}，实际停在 ${actual?.path ?? '(取不到)'}`);
      continue;
    }

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

    // 画出来了，但画的是不是「失败」？取整页文字再扫标记。
    //
    // **「读不到」与「读到是空的」必须分开。** 从前两者都走同一个 catch，
    // 于是 `wxml()` 一旦失败，这一屏就静默地算作「没有错误提示」——
    // 报出来的 0 可能是「0 个错误」，也可能是「0 次成功读取」，而两者意思相反。
    // 静默跳过的检查与静默截短的检查是同一种毛病。
    let pageText = '';
    let readOk = false;
    try {
      const wxml = await page.wxml();
      pageText = (typeof wxml === 'string' ? wxml : JSON.stringify(wxml)).replace(/<[^>]*>/g, ' ');
      readOk = pageText.trim().length > 0;
    } catch { /* 读不到 —— 记下来，不当作「没有错误」 */ }
    if (!readOk) readFail.push(route);

    // **有的屏本来就需要参数**（某条活动的详情页要 activity_id）。不带参数进不去
    // 是设计好的，而它会写一句「缺少活动编号，请从党建活动列表进入」。
    // 那是**正确的守门文案，不是缺陷** —— 不加这条豁免，这道检查就天天狼来了。
    // 2026-09-12 实测：第一次跑，唯一一条命中就是这种（`/pages/party-activity-detail/index`）。
    // 教训与 §7.6 同一条：比对了字串，不等于比对了语意。
    const GUARD = [/请从[^，。]{0,24}进入/, /缺少[^，。]{0,16}(编号|参数)/];
    const marker = GUARD.some((re) => re.test(pageText))
      ? null
      : ERROR_MARKERS.find((re) => re.test(pageText));
    if (marker) errors.push({ route, marker: String(marker) });

    console.log(`✓ ${route}（${spec.label}）`);
    console.log(`   元素: ${found.join('  ') || '(这一屏没配选择器)'}`);
    console.log(`   data 键: ${Object.keys(data).slice(0, 12).join(', ')}`);
    console.log(`   截图: ${shot}`);
    if (marker) console.log(`   ⚠ 渲染态: 屏上出现错误提示 ${marker}`);
    ok++;
  } catch (err) {
    bad.push({ route, err: String(err.message ?? err).slice(0, 160) });
    console.log(`✗ ${route} —— ${String(err.message ?? err).slice(0, 160)}`);
  }
}

try { mp.disconnect(); } catch { /* 新版 disconnect 是同步的，返回 void */
}
// **只断开连接，不关会话。** `mp.close()` 会把自动化会话关掉 —— 那是共享资源，
// 关掉它下一次跑就得重建（要等工程重载），而并行的工具（逐页对照）也接不上。
// IDE 同样留着不关，理由一致。
if (ide) console.log('  IDE 留着不关 —— 下一次跑直接接上。要关它：node .claude/skills/hualong-api-test/scripts/wxcli.mjs quit');

console.log(`\n跑通 ${ok} 屏，失败 ${bad.length} 屏。`);

// 画出来了但画错内容的屏。**不并入 bad** —— 前者是「没画出来」，后者是
// 「画出来了、画的是失败」。两层要分开报，合成一个数就分不出是哪一种。
if (errors.length) {
  console.log(`\n渲染态有错误的屏 ${errors.length} 屏（画出来了，但画的是失败提示）：`);
  for (const e of errors) console.log(`  ⚠ ${e.route}  —— 屏上出现 ${e.marker}`);
}

// 读不到就必须说出来。**不说，那个 0 就会被读成「没有错误」。**
if (readFail.length) {
  console.log(`\n读不到页面文字的屏 ${readFail.length} 屏（**这几屏没被检查过**，不是「没有错误」）：`);
  for (const r of readFail.slice(0, 10)) console.log(`  ? ${r}`);
  if (readFail.length > 10) console.log(`  …还有 ${readFail.length - 10} 屏`);
}

if (bad.length) {
  console.log('\n失败的屏：');
  for (const b of bad) console.log(`  ${b.route}\n    ${b.err}`);
  process.exit(1);
}
