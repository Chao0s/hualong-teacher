/**
 * Writes the contract viewer out as static files, for GitHub Pages.
 *
 * Run:  node tools/build-api-doc.mjs <outdir>     (default: dist/api-doc)
 *
 * The local viewer (`npm run swagger`) reads the contract on every request and
 * copies nothing — that is the right shape for a machine that has the backend
 * repo mounted. Pages has no such machine and no Node process, so the site is
 * generated: this script is the only place a copy of `openapi.yaml` is ever
 * made, and it makes it at publish time so the copy cannot outlive the build.
 *
 * A stale copy is worse than none (`tools/openapi-source.mjs`), so nothing this
 * script writes is committed. `dist/` is ignored; CI builds and uploads it.
 *
 * Try-it-out still works from the published site, but only against a mock the
 * reader runs themselves: `npm run mock` on port 3820. Browsers exempt
 * `127.0.0.1` from mixed-content blocking and the mock already sends
 * `access-control-allow-origin: *`, so an https:// page can reach it.
 */

import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specPath, specText } from './openapi-source.mjs';
import { usedFrom } from './lib/screen-ops-data.mjs';
import { indexPage, rolesPage, specForUi, pagesSpecForUi, rawViewer } from './swagger/pages.mjs';
import { pagesPage } from './swagger/pages-view.mjs';

const UI_DIST = dirname(fileURLToPath(import.meta.resolve('swagger-ui-dist/swagger-ui.css')));

// Only what the two pages load. swagger-ui-dist also ships an es-bundle, a
// standalone HTML and source maps; shipping those triples the artifact for
// nothing.
const ASSETS = ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js'];

const NOTE = 'Try-it-out 需要本地测试后端（127.0.0.1:3860）与有效会话；Servers 也可选 mock（3820），本站没有后端';

const out = resolve(process.argv[2] || 'dist/api-doc');
mkdirSync(out, { recursive: true });

// 顶栏那一组链接，与本地服务（tools/swagger/server.mjs 的 NAV_URLS）同一个集合，
// 只有网址形式不同：这里是同一目录下的文件。
//
// `/review` 两边都没有了 —— 2026-09-12 用户拍板把「检测评审」并进「按屏幕看」，
// 本地回 302，这里就是同一份 `pages.html`。`NO_REVIEW` 留着：`omit` 是「这个键故意不给」
// 的那句声明 —— 少一个键 nav.mjs 当场抛错（那是故意的），写下来才看得出是故意、不是漏了。
//
// 静态站没有 `/feedback` 路由，所以 `/pages` 那一份**不画可写的控件**（`canWrite:false`）。
// 画一个按了会静默失败的按钮，比说清楚「回本机留结论」更坏。
const NAV_URLS = {
  home: './index.html',
  roles: './roles.html',
  pages: './pages.html',
  raw: './openapi.yaml',
  spec: './pages.yaml',
};
const NO_REVIEW = ['review'];
const RAW_HTML = { href: './openapi.html', label: '原文（HTML，中文不乱码）' };
const SPEC_HTML = { href: './pages-spec.html', label: '按屏幕的规格（HTML，中文不乱码）' };

writeFileSync(join(out, 'index.html'), indexPage({
  specUrl: './openapi.local.yaml',
  navUrls: NAV_URLS,
  omit: NO_REVIEW,
  extra: [RAW_HTML],
  note: NOTE,
}));
writeFileSync(join(out, 'roles.html'), rolesPage({
  navUrls: NAV_URLS,
  omit: NO_REVIEW,
  extra: [RAW_HTML],
}));
writeFileSync(join(out, 'pages.html'), pagesPage({
  navUrls: NAV_URLS,
  omit: NO_REVIEW,
  extra: [RAW_HTML, SPEC_HTML],
  canWrite: false,   // 静态站没有 /feedback 路由：不画按了会静默失败的按钮
}));
writeFileSync(join(out, 'pages.yaml'), pagesSpecForUi());
writeFileSync(join(out, 'openapi.yaml'), specText());
writeFileSync(join(out, 'openapi.local.yaml'), specForUi());

// 原文的「人读」视图。**只在 Pages 构建里生成**：本地的 server 已经把 .yaml 发成
// `charset=utf-8`，只有 Pages 会发无 charset 的 `text/yaml`，中文在那里才会乱码。
// 理由与完整解释见 pages.mjs 的 rawViewer()。
// 两页各自省掉自己正在显示的那一份原件（它就在眼前，顶栏不再给第二个入口）；
// 全文由顶栏的「下载 YAML」取。
writeFileSync(join(out, 'openapi.html'), rawViewer({
  text: specText(),
  title: 'hualong-backend/api/openapi.yaml（原始契约，未注入 ELI10）',
  urls: NAV_URLS,
  omit: [...NO_REVIEW, 'raw'],
  downloadUrl: './openapi.yaml',
  downloadLabel: '下载 YAML',
}));
writeFileSync(join(out, 'pages-spec.html'), rawViewer({
  text: pagesSpecForUi(),
  title: '按屏幕分组的派生 spec（167 个操作全保留，tag = 屏幕名）',
  urls: NAV_URLS,
  omit: [...NO_REVIEW, 'spec'],
  downloadUrl: './pages.yaml',
  downloadLabel: '下载 YAML',
}));

for (const a of ASSETS) {
  const from = join(UI_DIST, a);
  if (!existsSync(from)) throw new Error(`swagger-ui-dist 缺 ${a}：${from}`);
  copyFileSync(from, join(out, a));
}

console.log(`契约   ${specPath()}`);
const u = usedFrom();
console.log(`两份表 ${u.root}  （来源：${u.how}）`);
console.log(`站点   ${out}`);
console.log(`文件   ${['index.html', 'roles.html', 'pages.html', 'openapi.html', 'pages-spec.html', 'openapi.yaml', 'openapi.local.yaml', 'pages.yaml', ...ASSETS].join(', ')}`);
