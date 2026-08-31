#!/usr/bin/env node
/**
 * web-capture —— 抓静态网页的 HTML、CSS、JS，一页存一个 .txt。
 *
 * 直接走 HTTP，不开浏览器。适用于 CSS 和 JS 写在页面里、或用 <link>/<script src>
 * 外链的静态站。拿不到 JS 执行后的 DOM —— 那种情况看 SKILL.md 的说明。
 *
 * 用法：
 *   node capture.js --url <起始页> --out <目录> [--depth N] [--limit N]
 *
 *   --url    起始页面地址，必填
 *   --out    输出目录，必填，不存在会创建
 *   --depth  跟链层数，默认 99（整站爬完）。0 表示只抓起始页
 *   --limit  最多抓几页，默认 200，防跑飞
 *
 * 只跟同源、且在起始页所在目录之下的链接。<a href> 和 <iframe src> 都跟。
 */

const fs = require('fs');
const path = require('path');

// ── 参数 ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith('--') ? next : 'true';
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.url || !args.out) {
  console.error('用法: node capture.js --url <起始页> --out <目录> [--depth N] [--limit N]');
  process.exit(1);
}

// --url 可以给多个，逗号分隔。站上常有没人链接的孤儿页（未上线草稿、组件示例页），
// 光靠跟链到不了，只能点名。第一个地址决定抓取范围和文件名的相对起点。
const START_URLS = args.url.split(',').map((u) => u.trim()).filter(Boolean);
const START_URL = START_URLS[0];
const OUT_DIR = args.out;
const MAX_DEPTH = args.depth === undefined ? 99 : Number(args.depth);
const MAX_PAGES = args.limit === undefined ? 200 : Number(args.limit);

// ── 抓取 ──────────────────────────────────────────────────────────────────

const failedResources = [];

async function fetchText(url, type) {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const text = await response.text();
    return { ok: true, content: text.replace(/^﻿/, '') };
  } catch (error) {
    const failure = { type, url, error: String(error) };
    failedResources.push(failure);
    return { ok: false, content: '', error: String(error) };
  }
}

// ── 从 HTML 里挑东西 ──────────────────────────────────────────────────────
//
// 用正则，不用 DOM 解析器 —— 目标是原型站这类规整的手写 HTML，装依赖不值得。
// 代价：属性里嵌了 `>` 的畸形标签会漏。SKILL.md 里写明了这条边界。

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : '';
}

function extractStyles(html) {
  const styles = [];
  let index = 0;
  for (const m of html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)) {
    index += 1;
    styles.push({ type: 'inline', index, media: attr(m[1], 'media'), content: m[2] });
  }
  const links = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["'][^"']*stylesheet/i.test(tag)) continue;
    const href = attr(tag, 'href');
    if (href) links.push({ href, media: attr(tag, 'media') });
  }
  return { styles, links };
}

function extractScripts(html) {
  const scripts = [];
  const externals = [];
  let index = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    index += 1;
    const tag = m[1];
    const src = attr(tag, 'src');
    const scriptType = attr(tag, 'type') || 'text/javascript';
    if (src) {
      externals.push({ index, src, scriptType, async: /\basync\b/i.test(tag), defer: /\bdefer\b/i.test(tag) });
    } else if (m[2].trim()) {
      scripts.push({ type: 'inline', index, scriptType, content: m[2] });
    }
  }
  return { scripts, externals };
}

function extractResources(html, baseUrl) {
  const urls = new Set();
  for (const m of html.matchAll(/<(?:img|source|video|audio|embed)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    urls.add(m[1]);
  }
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    if (!m[1].startsWith('data:')) urls.add(m[1]);
  }
  return [...urls].map((raw) => {
    let resolved = raw;
    try { resolved = new URL(raw, baseUrl).href; } catch (e) { /* 保留原样 */ }
    return { raw, url: resolved };
  });
}

function extractLinks(html, baseUrl) {
  const found = new Set();
  const patterns = [
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi,
    /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi,
    // 页面脚本常把下级页面写成字符串再拼给 innerHTML，例如
    //   `growth-book-section-materials.html?id=${item.key}`
    //   item.key === 'time' ? 'growth-book-time-manage.html' : 'growth-book-task-manage.html'
    // 这些链接不在 <a href> 里，只扫标签会漏掉整支页面。
    // 字符类不含 $ 和 {，所以 `${...}` 这种没算出来的模板串不会被当成地址。
    /["'`]([A-Za-z0-9_\-./]+\.html(?:\?[^"'`]*)?)["'`]/g,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      let raw = m[1].trim();
      if (!raw || raw.startsWith('#') || /^(mailto:|tel:|javascript:|data:)/i.test(raw)) continue;

      // 脚本模板里的地址常带没算出来的占位符。分两种：
      //   href="${sectionHref(item)}"          整条都是占位符，没有路径可用，丢掉
      //   href="materials.html?id=${item.key}" 路径是真的，只有 query 是占位符，留路径
      const [rawPath, rawQuery] = [raw.slice(0, (raw + '?').indexOf('?')), raw.slice(raw.indexOf('?'))];
      if (rawPath.includes('${')) continue;
      if (rawQuery && rawQuery.includes('${')) raw = rawPath;
      try {
        const url = new URL(raw, baseUrl);
        url.hash = '';
        found.add(url.href);
      } catch (e) { /* 解析不了就丢掉 */ }
    }
  }
  return [...found];
}

function extractEnvironment(html, url) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  const viewportTag = (html.match(/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i) || [''])[0];
  const viewportContent = viewportTag ? attr(viewportTag, 'content') : '';
  const charsetTag = (html.match(/<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i) || [, ''])[1];
  const u = new URL(url);

  const environment = {
    exportedAt: new Date().toISOString(),
    page: { url, origin: u.origin, pathname: u.pathname, title, charset: charsetTag || '' },
  };

  // 视口只在页面自己声明了 <meta viewport> 时才写。抓不到的字段一律不写，
  // 不编造 —— HTTP 抓取量不到 devicePixelRatio、屏幕尺寸这些。
  if (viewportContent) {
    const width = (viewportContent.match(/width\s*=\s*([\w.]+)/i) || [, ''])[1];
    environment.viewport = { declared: viewportContent };
    if (width && width !== 'device-width') environment.viewport.width = Number(width);
  }
  return environment;
}

// ── 文件名 ────────────────────────────────────────────────────────────────

function slugFor(url, base) {
  let rel = url;
  try {
    rel = decodeURIComponent(new URL(url).pathname);
    const basePath = new URL(base).pathname.replace(/[^/]*$/, '');
    if (rel.startsWith(basePath)) rel = rel.slice(basePath.length);
  } catch (e) { /* 用原串 */ }
  rel = rel.replace(/\.html?$/i, '').replace(/^\/+|\/+$/g, '');
  if (!rel) rel = 'index';
  return rel.replace(/[/\\]/g, '__').replace(/[^\w.\-一-鿿]/g, '_');
}

// ── 单页 ──────────────────────────────────────────────────────────────────

async function capturePage(url) {
  // 每页的失败清单只记本页抓出来的那几条，不把上一页的也算进来
  const failuresBefore = failedResources.length;
  const page = await fetchText(url, 'html');
  if (!page.ok) return null;

  const html = page.content;
  const { styles, links: cssLinks } = extractStyles(html);
  const { scripts, externals } = extractScripts(html);

  for (const link of cssLinks) {
    const cssUrl = new URL(link.href, url).href;
    const result = await fetchText(cssUrl, 'css');
    styles.push({
      type: 'external', url: cssUrl, media: link.media,
      loaded: result.ok, error: result.error || null, content: result.content,
    });
  }

  for (const ext of externals) {
    const jsUrl = new URL(ext.src, url).href;
    const result = await fetchText(jsUrl, 'javascript');
    scripts.push({
      type: 'external', index: ext.index, url: jsUrl, scriptType: ext.scriptType,
      async: ext.async, defer: ext.defer,
      loaded: result.ok, error: result.error || null, content: result.content,
    });
  }

  return {
    exportFormat: 'browser-ui-debug-package',
    exportVersion: 1,
    capturedBy: 'http-fetch',
    instructionsForAI: [
      'sourceHTML 是服务器返回的原始 HTML，不是 JS 执行后的 DOM。',
      '页面若用 JS 生成列表，模板和数据都在 scripts 里；那些 `.map(...)` 对应小程序的 wx:for，数组对应 data。',
      'styles 含页面内联的 <style> 和外链 CSS 的正文。',
      'scripts 含内联脚本和外链 JS 的正文。',
      'failedResources 列出取不到的文件。',
      'links 是本页指向的站内页面，用来追多级页面。',
      '转微信小程序时重点看 display、position、box-sizing、flex、grid、overflow、字体、行高和尺寸单位。',
      '本文件不含截图。排版是否跑位要另外截图比对，见 web-capture 的 SKILL.md。',
    ],
    environment: extractEnvironment(html, url),
    sourceHTML: html,
    styles,
    scripts,
    resources: extractResources(html, url),
    links: extractLinks(html, url),
    failedResources: failedResources.slice(failuresBefore),
  };
}

// ── 爬 ────────────────────────────────────────────────────────────────────

function sameScope(url, base) {
  try {
    const u = new URL(url);
    const b = new URL(base);
    if (u.origin !== b.origin) return false;
    const baseDir = b.pathname.replace(/[^/]*$/, '');
    if (!u.pathname.startsWith(baseDir)) return false;
    // 只跟 HTML；带别的扩展名的（.pdf、.png…）不当页面抓
    const ext = (u.pathname.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
    return ext === '' || ext === 'html' || ext === 'htm';
  } catch (e) {
    return false;
  }
}

/**
 * 静态站上 `page.html?a=1` 和 `page.html?b=2` 是同一个文件，服务器返回的字节一模一样。
 * 按整条 URL 去重会把同一页抓几十遍，还都写进同一个 .txt 里互相覆盖，
 * 清单上却显示成几十个页面。所以按路径去重，query 只记下来。
 */
function pathKey(url) {
  try { return new URL(url).pathname; } catch (e) { return url; }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const queue = START_URLS.map((url) => ({ url, depth: 0 }));
  const seen = new Set(START_URLS.map(pathKey));
  // 路径 → 见过的 query 串，用来在清单里说明同一页有几个入参变体
  const variants = new Map();
  const manifest = [];

  while (queue.length && manifest.length < MAX_PAGES) {
    const { url, depth } = queue.shift();
    process.stdout.write(`[${manifest.length + 1}] ${url} ... `);

    const pkg = await capturePage(url);
    if (!pkg) { console.log('抓取失败'); continue; }

    const slug = slugFor(url, START_URL);
    const file = path.join(OUT_DIR, `${slug}.txt`);
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2), 'utf8');

    const bytes = fs.statSync(file).size;
    manifest.push({
      slug, url, depth, title: pkg.environment.page.title,
      bytes, styles: pkg.styles.length, scripts: pkg.scripts.length,
      links: pkg.links.filter((l) => sameScope(l, START_URL)).length,
    });
    console.log(`${slug}.txt  ${bytes.toLocaleString()} 字节`);

    if (depth >= MAX_DEPTH) continue;
    for (const link of pkg.links) {
      if (!sameScope(link, START_URL)) continue;
      const key = pathKey(link);
      const query = link.slice(link.indexOf(key) + key.length);
      if (query) {
        if (!variants.has(key)) variants.set(key, new Set());
        variants.get(key).add(query);
      }
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ url: link, depth: depth + 1 });
    }
  }

  // 目录页：56 个 txt 摊在一个文件夹里，没有这张表没法用
  const lines = [
    `web-capture 抓取清单`,
    `起始页: ${START_URLS.join('\n        ')}`,
    `抓取时间: ${new Date().toISOString()}`,
    `页数: ${manifest.length}${queue.length ? `（还有 ${queue.length} 页未抓，受 --limit ${MAX_PAGES} 限制）` : ''}`,
    `失败资源: ${failedResources.length}`,
    '',
    ['文件', '层', '标题', '字节', 'CSS', 'JS', '站内链接', 'query变体'].join('\t'),
    ...manifest.map((m) => [
      `${m.slug}.txt`, m.depth, m.title, m.bytes, m.styles, m.scripts, m.links,
      (variants.get(pathKey(m.url)) || new Set()).size,
    ].join('\t')),
  ];

  // query 变体只抓一次，但要写下来，免得看清单的人以为站上没有这些入参
  const withVariants = [...variants.entries()].filter(([, set]) => set.size);
  if (withVariants.length) {
    lines.push('', 'query 变体（同一个 HTML，只抓了一次）:');
    for (const [p, set] of withVariants) {
      lines.push(`  ${p}`, ...[...set].map((q) => `      ${q}`));
    }
  }
  if (failedResources.length) {
    lines.push('', '失败资源:', ...failedResources.map((f) => `  [${f.type}] ${f.url} — ${f.error}`));
  }
  fs.writeFileSync(path.join(OUT_DIR, '_index.txt'), lines.join('\n'), 'utf8');

  console.log('---');
  console.log(`共 ${manifest.length} 页，失败资源 ${failedResources.length} 个`);
  console.log(`清单: ${path.join(OUT_DIR, '_index.txt')}`);
  if (queue.length) console.log(`⚠️ 还有 ${queue.length} 页没抓，被 --limit ${MAX_PAGES} 截断`);
}

main().catch((error) => {
  console.error('抓取失败:', error);
  process.exit(1);
});
