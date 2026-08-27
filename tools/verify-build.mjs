/**
 * Static compile check for the Mini Program.
 *
 * A native Mini Program has no build step and produces no dist/, so there is
 * nothing to run and inspect the way a bundler lets you. The compiler lives
 * inside WeChat DevTools. This stands in for it: it reads what DevTools reads
 * and fails on what DevTools would reject.
 *
 * WHY THIS EXISTS RATHER THAN A REAL COMPILE — measured 2026-08-26, not assumed,
 * because the assumption is worth checking once and expensive to re-check:
 *
 *   ci.Project              refuses to construct: "privateKeyPath should not be
 *                           empty". Every upload/preview path goes through it.
 *   ci.getCompiledResult    looks like a compile-without-upload, but validates
 *                           its argument as `upload` does and wants a full
 *                           Project. Same key requirement.
 *   ci.DevtoolsProject      constructs WITHOUT a key, and is inert — projectPath
 *                           comes back empty, the file set is size 0, _ready is
 *                           false. It is the IDE's own bridge object; away from
 *                           a running IDE it does nothing.
 *   DevTools CLI            compiles with no key at all, using the IDE's logged-in
 *                           session — but needs 设置 → 安全设置 → 服务端口. And
 *                           `cli quit` cannot help you turn it on, because the CLI
 *                           reaches the IDE THROUGH that port.
 *
 * So: a real compile needs either a PEM upload key (plus an IP allowlist entry)
 * or one human toggle in the IDE. Neither is something this file can supply.
 *
 * It exists because of commit 6b24802 — four entry pages shipped `{{{{ready}}}}`
 * and could not compile, while 76 tests passed, because the tests read the files
 * and asserted about their contents rather than about their validity. Bindings
 * are now covered by tests/navigation.test.mjs; everything else is covered here.
 *
 * Run:  npm run verify:build
 * Exit: 0 clean, 1 with findings.
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const ROOT = resolve(REPO, 'miniprogram');

/**
 * `--release` 打开正式构建路径的额外检查（票据 23 验收项）。
 *
 * 关闭域名校验最危险的地方是：它留着不影响任何日常开发，只在提审那天变成阻断。
 * 所以日常 `npm run verify:build` 照旧放行，`npm run verify:release` 拦下它。
 * 一笔债要么有人记着，要么有一道闸记着 —— 后者不会忘。
 */
const RELEASE = process.argv.includes('--release');

// 微信平台硬上限：主包 2 MB，整包（含分包）20 MB。超过就是上传被拒，不是警告。
const MAIN_PACKAGE_LIMIT = 2 * 1024 * 1024;
const TOTAL_LIMIT = 20 * 1024 * 1024;
// tabBar 上限即五（DO-NOT-BUILD 14）。第六个模块入口走页面内入口。
const TAB_CEILING = 5;

// 分包与服务模块一一对应（票据 12）：一个分包只对应一个服务模块，不跨模块。
// 这是本文件里唯一的一处声明 —— 新增一个分包只改这里，检查逻辑不动。
const SUBPACKAGE_SERVICES = {
  'packages/party': 'party',
  'packages/coordination': 'coordination',
  'packages/library': 'library',
  'packages/training': 'training',
  // 五维评价（票据 18）自成一个分包，与资源库借教研培训落一条门是同一个形状：一个
  // tabBar 模块可以带不止一个分包，`preloadRule` 上写着 library／training／assessment
  // 三个。分开的理由是服务模块边界 —— 量表与研修没有共用的读写面。
  'packages/assessment': 'assessment',
  // 办园质量评估（2026-08-27）。与 packages/assessment 是**两件不同的量具**：那个评
  // 一名幼儿的五大领域（124 题），这个评园所（9 个一级指标、120 题）。读写面没有一行
  // 共用，所以是两个分包两个服务，不是一个分包塞两套。
  'packages/quality': 'quality',
  'packages/co-education': 'co-education',
  // 评价链（票据 20）与成长册（票据 21）在结构契约上都属 co-education 模块，但**模块与
  // 分包不是一回事**：一个 tabBar 模块可以带不止一个分包，正如 assessment 借教研培训落门。
  // 分开的理由与 assessment 相同 —— 服务模块边界：在园时光与亲子任务的读写面和评价链、
  // 成长册没有一行共用。
  'packages/evaluation': 'evaluation',
  'packages/growth-book': 'growth-book',
};

const findings = [];
const note = (file, message) => findings.push({ file, message });

function readJson(absPath, label) {
  try {
    return JSON.parse(readFileSync(absPath, 'utf8'));
  } catch (err) {
    note(rel(absPath), `${label} 不是合法 JSON：${err.message}`);
    return null;
  }
}

const rel = (p) => relative(REPO, p).replace(/\\/g, '/');

// ── app.json：页面注册 ──────────────────────────────────────────────────────

const appJsonPath = join(ROOT, 'app.json');
if (!existsSync(appJsonPath)) {
  console.error('找不到 miniprogram/app.json，无法继续。');
  process.exit(1);
}
const app = readJson(appJsonPath, 'app.json') || {};

/** A page needs .js, .json and .wxml. .wxss is optional — a page may inherit. */
function checkPageFiles(pagePath, origin) {
  const base = join(ROOT, pagePath);
  for (const ext of ['.js', '.json', '.wxml']) {
    if (!existsSync(base + ext)) note(`${pagePath}${ext}`, `${origin} 注册了这个页面，但文件不存在`);
  }
}

const registered = new Set(app.pages || []);
for (const p of app.pages || []) checkPageFiles(p, 'app.json pages');

if (!registered.size) note('miniprogram/app.json', 'pages 为空，小程序没有任何页面');

// ── 分包 ────────────────────────────────────────────────────────────────────

const subPackages = app.subPackages || app.subpackages || [];
const subRoots = [];
for (const sub of subPackages) {
  if (!sub.root) { note('miniprogram/app.json', '分包缺少 root'); continue; }
  const rootDir = join(ROOT, sub.root);
  if (!existsSync(rootDir)) { note(`miniprogram/${sub.root}`, '分包 root 目录不存在'); continue; }
  subRoots.push(sub.root.replace(/\/$/, ''));
  for (const p of sub.pages || []) {
    const full = `${sub.root.replace(/\/$/, '')}/${p}`;
    checkPageFiles(full, `分包 ${sub.root}`);
    if (registered.has(full)) {
      note(`${full}`, '同一页面同时登记在主包 pages 与分包 pages —— 编译会拒绝');
    }
    registered.add(full);
  }
}

// ── tabBar ─────────────────────────────────────────────────────────────────

const tabs = app.tabBar?.list || [];
if (tabs.length > TAB_CEILING) {
  note('miniprogram/app.json', `tabBar 有 ${tabs.length} 项，平台上限 ${TAB_CEILING}（DO-NOT-BUILD 14）`);
}
for (const tab of tabs) {
  if (!registered.has(tab.pagePath)) {
    note('miniprogram/app.json', `tabBar 指向未注册的页面：${tab.pagePath}`);
  }
  // A tab page must be in the MAIN package. WeChat refuses a tab in a subpackage.
  if (subRoots.some((r) => tab.pagePath.startsWith(`${r}/`))) {
    note('miniprogram/app.json', `tabBar 页面在分包里：${tab.pagePath} —— 必须在主包`);
  }
  for (const key of ['iconPath', 'selectedIconPath']) {
    const icon = tab[key];
    if (!icon) continue;
    if (!existsSync(join(ROOT, icon))) note('miniprogram/app.json', `tabBar ${key} 文件不存在：${icon}`);
  }
}

if (app.sitemapLocation && !existsSync(join(ROOT, app.sitemapLocation))) {
  note('miniprogram/app.json', `sitemapLocation 指向不存在的文件：${app.sitemapLocation}`);
}

// ── 遍历全部源文件 ──────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);

for (const file of files) {
  const ext = extname(file);
  if (ext === '.json') checkJsonFile(file);
  else if (ext === '.js') checkJsFile(file);
  else if (ext === '.wxml') checkWxmlFile(file);
  else if (ext === '.wxss') checkWxssFile(file);
}

// ── 分包边界：一个分包只对应一个服务模块 ────────────────────────────────────
//
// 分包切错了不会报错，只会在真机上多下一个包、并且把两个模块的代码绑在一起下发。
// 服务层是模块边界（票据 08 定型），所以这里按 require 的服务模块判定归属。

// ── 主包不得 require 分包里的文件 ───────────────────────────────────────────
//
// 平台规则是单向的：**分包读得到主包，主包读不到分包**。违反它不是编译错误，是
// **运行时错误**，而且炸在启动那一刻 —— 主包的 bundle 里根本没有那个模块：
//
//   module 'packages/quality/assets/tool.js' is not defined,
//   require args is '../packages/quality/assets/tool'
//
// 2026-08-27 真踩了一次：`services/quality.js`（主包）require 了办园质量评估的题库
// （分包内），而首页 require 了那个服务 —— 于是首页一进来整个应用就白屏。静态检查
// 当时全绿，测试也全绿，因为 Node 的 require 没有分包这个概念。所以这一条必须在这里
// 拦：它是本文件唯一能替真机挡下的那类错。
{
  const roots = subRoots.map((r) => r.replace(/\\/g, '/'));
  for (const file of files) {
    if (extname(file) !== '.js') continue;
    const relPath = rel(file).replace(/\\/g, '/');
    const inSub = roots.some((root) => relPath.includes(`/${root}/`));
    if (inSub) continue;   // 分包内的文件读主包是允许的，不必查

    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      const target = m[1];
      if (!target.includes('packages/')) continue;
      const hit = roots.find((root) => target.includes(root.split('/').pop()));
      note(relPath,
        `主包文件 require 了分包里的模块 ${target}`
        + `${hit ? `（分包 ${hit}）` : ''} —— 平台规则是分包读主包，反过来不行，`
        + '这会在启动时抛 “module … is not defined”。把它挪进主包，或让分包内的调用方传进来。');
    }
  }
}

for (const root of subRoots) {
  const allowed = SUBPACKAGE_SERVICES[root];
  if (!allowed) {
    note('tools/verify-build.mjs', `分包 ${root} 未声明它对应哪个服务模块，请加进 SUBPACKAGE_SERVICES`);
    continue;
  }
  for (const file of files) {
    const r = relative(ROOT, file).replace(/\\/g, '/');
    if (!r.startsWith(`${root}/`) || extname(file) !== '.js') continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/require\(['"][^'"]*services\/([\w-]+)['"]\)/g)) {
      if (m[1] !== allowed) {
        note(r, `引用了 services/${m[1]}，但分包 ${root} 只对应 services/${allowed}。`
          + `把这个页面挪到 services/${m[1]} 所属的分包，或把它留在主包。`);
      }
    }
  }
}

/** Component references must resolve, or the page renders an empty box silently. */
function checkJsonFile(file) {
  const json = readJson(file, rel(file));
  if (!json) return;
  const using = json.usingComponents || {};
  for (const [tag, path] of Object.entries(using)) {
    // A plugin:// reference is resolved by the platform, not by us.
    if (path.startsWith('plugin://')) continue;
    const target = path.startsWith('/')
      ? join(ROOT, path.slice(1))
      : resolve(dirname(file), path);
    if (!existsSync(`${target}.json`)) {
      note(rel(file), `usingComponents["${tag}"] 指向不存在的组件：${path}`);
      continue;
    }
    const def = readJson(`${target}.json`, rel(`${target}.json`));
    if (def && def.component !== true) {
      note(rel(`${target}.json`), '被当作组件引用，但没有声明 "component": true');
    }
  }
}

/**
 * Syntax only. Mini Program JS is CommonJS, so compiling it as a script is the
 * same parse the compiler does — no module resolution, no execution.
 */
function checkJsFile(file) {
  const src = readFileSync(file, 'utf8');
  try {
    new Script(src, { filename: file });
  } catch (err) {
    note(rel(file), `JS 语法错误：${err.message}`);
  }
}

function checkWxmlFile(file) {
  const src = readFileSync(file, 'utf8');
  // The 6b24802 shape. tests/navigation.test.mjs covers well-formed bindings in
  // depth; this catches the specific generator artefact at build time too,
  // because a compile check that misses the one bug that broke the build is not
  // a compile check.
  if (/\{\{\{\{/.test(src)) note(rel(file), '出现 {{{{ —— 模板转义未展开，编译会失败');
  const opens = (src.match(/\{\{/g) || []).length;
  const closes = (src.match(/\}\}/g) || []).length;
  if (opens !== closes) note(rel(file), `插值括号不配对：${opens} 个 {{，${closes} 个 }}`);

  // Unclosed custom/native tags. Self-closing and void forms are excluded.
  //
  // Comments are stripped first, and that is not a convenience: a WXML comment is
  // not markup, so a tag written inside one is prose. Counting it made this check
  // report a false unclosed tag on any file whose comment named an element — for
  // example the several pages that record why the prototype's `select` dropdown
  // has no WXML counterpart (ADR-0017). Found 2026-08-26 while building the
  // growth-record chain; three real files were flagged, none of them broken.
  const stack = [];
  const markup = src.replace(/<!--[\s\S]*?-->/g, '');
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(markup)) !== null) {
    const [, slash, name, , selfClose] = m;
    if (selfClose) continue;
    if (slash) {
      if (stack.pop() !== name) {
        note(rel(file), `标签闭合不匹配，出现 </${name}>`);
        return;
      }
    } else {
      stack.push(name);
    }
  }
  if (stack.length) note(rel(file), `标签未闭合：<${stack.join('>, <')}>`);
}

function checkWxssFile(file) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/@import\s+["']([^"']+)["']/g)) {
    const target = m[1].startsWith('/')
      ? join(ROOT, m[1].slice(1))
      : resolve(dirname(file), m[1]);
    if (!existsSync(target)) note(rel(file), `@import 指向不存在的文件：${m[1]}`);
  }
  const open = (src.match(/\{/g) || []).length;
  const close = (src.match(/\}/g) || []).length;
  if (open !== close) note(rel(file), `花括号不配对：${open} 个 {，${close} 个 }`);
}

// ── 悬空的设计令牌 ──────────────────────────────────────────────────────────
//
// `var(--nope)` 在 CSS 里不会报错：那条属性整个失效，元素就照没有它的样子渲染。
// 一个漏定义的 `--radius-lg` 表现为「这张卡怎么没有圆角」，而没有任何东西会说出
// 原因。原型自己就中过这一枪——`screens/growth-book.html` 与 `component-showcase.html`
// 都引用了从未定义的 `--radius-lg`。照抄原型时很容易把它一起抄过来。

{
  const styleFiles = files.filter((f) => ['.wxss', '.wxml'].includes(extname(f)));
  const defined = new Set();
  for (const f of styleFiles) {
    for (const m of readFileSync(f, 'utf8').matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
  }
  for (const f of styleFiles) {
    const r = relative(ROOT, f).replace(/\\/g, '/');
    for (const m of readFileSync(f, 'utf8').matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      if (!defined.has(m[1])) {
        note(r, `引用了从未定义的令牌 ${m[1]} —— 这条属性会整个失效，且不报任何错`);
      }
    }
  }
}

// ── 正式构建路径的额外闸（票据 23）──────────────────────────────────────────

if (RELEASE) {
  const shared = readJson(join(REPO, 'project.config.json'), 'project.config.json') || {};
  if (shared.setting?.urlCheck === false) {
    note('project.config.json',
      '域名校验仍关着（setting.urlCheck=false）。开发期靠它绕过未备案的域名，'
      + '正式包不得带着它出门 —— 打开它，或先把 API 域名备案并加进服务器域名白名单。');
  }
  // 生产档的 baseUrl 在域名落定前是空的；空着可以，填一个没备案的域名不行。
  const config = readFileSync(join(ROOT, 'config.js'), 'utf8');
  const prod = /prod\s*:\s*\{[\s\S]{0,300}?baseUrl\s*:\s*'([^']*)'/.exec(config);
  if (prod && prod[1] && !prod[1].startsWith('https://')) {
    note('miniprogram/config.js', `生产档 baseUrl 不是 https：${prod[1]}`);
  }
  if (!shared.appid || /^touristappid$/i.test(shared.appid)) {
    note('project.config.json', '正式包需要一个真实 AppID');
  }
}

// ── 包体积 ──────────────────────────────────────────────────────────────────

let mainBytes = 0;
let totalBytes = 0;
const subBytes = new Map(subRoots.map((sub) => [sub, 0]));
for (const file of files) {
  const size = statSync(file).size;
  totalBytes += size;
  const r = relative(ROOT, file).replace(/\\/g, '/');
  const owner = subRoots.find((sub) => r.startsWith(`${sub}/`));
  if (owner) subBytes.set(owner, subBytes.get(owner) + size);
  else mainBytes += size;
}
if (mainBytes > MAIN_PACKAGE_LIMIT) {
  note('miniprogram/', `主包 ${kb(mainBytes)}，超过 2 MB 上限。把阅读类页面搬进分包。`);
}
if (totalBytes > TOTAL_LIMIT) {
  note('miniprogram/', `整包 ${kb(totalBytes)}，超过 20 MB 上限。`);
}

function kb(n) { return `${(n / 1024).toFixed(1)} KB`; }

// ── 报告 ────────────────────────────────────────────────────────────────────

const pageCount = registered.size;
console.log('| 检查项 | 结果 |');
console.log('| --- | --- |');
console.log(`| 注册页面 | ${pageCount} 个（主包 ${(app.pages || []).length}，分包 ${pageCount - (app.pages || []).length}） |`);
console.log(`| 分包 | ${subPackages.length} 个 |`);
console.log(`| tabBar | ${tabs.length} / ${TAB_CEILING} |`);
console.log(`| 源文件 | ${files.length} 个 |`);
console.log(`| 主包体积 | ${kb(mainBytes)} / 2048.0 KB，余 ${kb(MAIN_PACKAGE_LIMIT - mainBytes)} |`);
for (const [sub, bytes] of subBytes) console.log(`| 分包 ${sub} | ${kb(bytes)} |`);
console.log(`| 整包体积 | ${kb(totalBytes)} / 20480.0 KB，余 ${kb(TOTAL_LIMIT - totalBytes)} |`);
console.log(`| 发现问题 | ${findings.length} 个 |`);

if (findings.length) {
  console.log('');
  for (const f of findings) console.log(`  ${f.file}\n    ${f.message}`);
  process.exit(1);
}
console.log('');
console.log('静态编译校验通过。真编译仍需 WeChat DevTools 或带上传密钥的 miniprogram-ci preview。');
