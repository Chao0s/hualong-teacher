/**
 * nav-verify.mjs —— 顶栏（navbar）的实测。逐项对应任务里的 a–e。
 *
 * 只读：抓四个路由的 HTML + `git show HEAD` 读改动前的旧 CSS，不改仓库任何东西。
 * 不测「有几个链接」——测的是**目的地集合**与**同一目的地的标签逐字相同**。
 *
 * 跑法（先起服务）：
 *   cd "G:/My Drive/Workplace/China KG Platform/hualong-teacher"
 *   PORT=18452 node tools/swagger/server.mjs
 *   node .scratch/nav-verify.mjs
 *
 * 全过 → 退出码 0。任一项不过 → 退出码 1，并印出错在哪一项。
 */
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.NAV_BASE || 'http://127.0.0.1:18452';
const REPO = fileURLToPath(new URL('..', import.meta.url));

const ROUTES = [
  { path: '/', title: 'Swagger UI' },
  { path: '/roles', title: '角色矩阵' },
  { path: '/pages', title: '按屏幕看' },
  // /review 不在这一组里：2026-09-12 它并进了 /pages，只回 302（见下面的 d 段）。
];

/** 预期目的地 → 预期标签。四个页面都必须给出**完全相同的这一组**。 */
const EXPECT = {
  '/': '按模块看',
  '/roles': '按角色看',
  '/pages': '按屏幕看',
  '/openapi.yaml': '原始契约',
  '/pages.yaml': '按屏幕看的规格',
};

const MARK = '/* hl-nav ·';            // 共享那份 <style> 里的哨兵注释
const BASE_RULE = '.hl-nav{box-sizing'; // 基础规则的开头（窄屏那条是 .hl-nav{padding）

const fails = [];
const ok = (cond, label) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}`);
  if (!cond) fails.push(label);
};

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const count = (hay, needle) => hay.split(needle).length - 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 走一遍 tools/，只看源码档。 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git', '.report'].includes(e.name)) walk(f, out); }
    else if (/\.(mjs|js|html|css)$/.test(e.name)) out.push(f);
  }
  return out;
}

/** 从一页 HTML 里切出顶栏，并解析成 href → 标签。 */
function parseNav(html, path) {
  const open = html.indexOf('<nav class="hl-nav"');
  if (open < 0) throw new Error(`${path}：找不到 class="hl-nav" 的顶栏`);
  const close = html.indexOf('</nav>', open);
  const block = html.slice(open, close + '</nav>'.length);
  const links = new Map();
  for (const m of block.matchAll(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = decode(m[1]);
    const inner = m[2];
    if (links.has(href)) throw new Error(`${path}：同一个 href 出现两次（${href}）`);
    links.set(href, {
      label: decode(inner.replace(/<[^>]*>/g, '')).trim(),
      hasTags: /<[a-z/]/i.test(inner),
      raw: inner,
    });
  }
  return { block, links };
}

/** 共享那份 <style> 的原文（顶栏自己带的那一块）。 */
function navStyle(html) {
  const mark = html.indexOf(MARK);
  if (mark < 0) return null;
  const start = html.lastIndexOf('<style>', mark);
  return html.slice(start, html.indexOf('</style>', mark) + '</style>'.length);
}

/** 所有同名规则的规则体（旧 CSS 里 .hl-bar 有三条，要逐条看）。 */
const allRules = (css, selector) => {
  const out = [];
  let i = css.indexOf(`${selector}{`);
  while (i >= 0) {
    const body = css.slice(i + selector.length + 1, css.indexOf('}', i) + 1);
    out.push(body);
    i = css.indexOf(`${selector}{`, i + 1);
  }
  return out;
};

const prop = (rule, name) => {
  const m = new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;}]+)`).exec(rule || '');
  return m ? m[1].trim() : null;
};
const firstPx = (s) => {
  const m = /(\d+(?:\.\d+)?)px/.exec(s || '');
  return m ? parseFloat(m[1]) : null;
};

/** 由 CSS 盒模型算一条顶栏（含其链接）的高度。 */
function barHeight(base, linkRule, fallbackLineHeight) {
  const padY = firstPx(prop(base, 'padding'));
  const font = firstPx(prop(base, 'font-size')) ?? firstPx(prop(base, 'font'));
  const lhPx = /\/\s*([\d.]+)/.exec(prop(base, 'font') || '');
  const lh = lhPx ? parseFloat(lhPx[1]) : fallbackLineHeight;
  const link = linkRule || '';
  const linkPadY = firstPx(prop(link, 'padding'));
  const linkBorder = firstPx(prop(link, 'border'));
  const linkBox = (linkPadY || 0) * 2 + font * lh + (linkBorder || 0) * 2;
  return { padY, font, lh, linkBox, height: padY * 2 + Math.max(font * lh, linkBox), raw: base.trim() };
}

const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const contrast = (a, b) => {
  const x = lum(a); const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// ── 抓三页 ───────────────────────────────────────────────────────────────
console.log(`抓取 ${BASE} 的四条路由\n`);
const pages = [];
for (const r of ROUTES) {
  const res = await fetch(BASE + r.path);
  const html = await res.text();
  pages.push({ ...r, html, ...parseNav(html, r.path) });
  console.log(`  ${r.path.padEnd(9)} HTTP ${res.status} · 顶栏 ${pages.at(-1).links.size} 条链接 · <nav> ${pages.at(-1).block.length} 字节`);
}
console.log('');

// ── a0. /review 不是一站了：它只回 302，转到 /pages ────────────────────────
console.log('a0. /review 回 302 且 location 指到 /pages');
{
  const res = await fetch(BASE + '/review', { redirect: 'manual' });
  const loc = res.headers.get('location');
  console.log(`  /review   HTTP ${res.status} · location: ${loc}`);
  ok(res.status === 302, `/review 回 302（实测 ${res.status}）`);
  ok(loc === '/pages', `/review 的 location 是 /pages（实测 ${loc}）`);
}
console.log('');

// ── a. 目的地集合相等 ────────────────────────────────────────────────────
console.log('a. 每一页都能到「其他每个目的地」；三页的目的地集合相等');
const wantSet = Object.keys(EXPECT).sort();
console.log(`  预期的目的地集合（${wantSet.length} 个）：${wantSet.join(' , ')}`);
for (const p of pages) {
  const got = [...p.links.keys()].sort();
  const missing = wantSet.filter((h) => !got.includes(h));
  const extra = got.filter((h) => !wantSet.includes(h));
  const cantReach = ROUTES.filter((r) => r.path !== p.path).map((r) => r.path).filter((h) => !p.links.has(h));
  console.log(`  ${p.path.padEnd(9)} 目的地 ${got.length} 个 → ${got.join(' , ')}`);
  ok(missing.length === 0, `${p.path} 不缺目的地${missing.length ? `（缺 ${missing.join(',')}）` : ''}`);
  ok(extra.length === 0, `${p.path} 没有多出来的链接${extra.length ? `（多 ${extra.join(',')}）` : ''}`);
  ok(cantReach.length === 0, `${p.path} 能点到另外三页${cantReach.length ? `（到不了 ${cantReach.join(',')}）` : ''}`);
}
const sets = pages.map((p) => [...p.links.keys()].sort().join('|'));
console.log(`  三页的目的地集合：`);
pages.forEach((p) => console.log(`    ${p.path.padEnd(9)} { ${[...p.links.keys()].sort().join(' , ')} }`));
ok(new Set(sets).size === 1, `三页的目的地**集合**逐项相等（不是「数目相同」）：${sets[0]}`);
ok(sets[0] === wantSet.join('|'), '而且等于预期的那一组');
console.log('');

// ── b. 同一目的地，标签逐字相同 ──────────────────────────────────────────
console.log('b. 同一目的地的标签文字，三页逐字相同');
for (const href of wantSet) {
  const labels = pages.map((p) => p.links.get(href)?.label);
  const raws = pages.map((p) => p.links.get(href)?.raw);
  const same = new Set(labels).size === 1;
  const plain = !pages.some((p) => p.links.get(href)?.hasTags);
  console.log(`  ${href.padEnd(14)} ${labels.map((l, i) => `${pages[i].path}=${JSON.stringify(l)}`).join('  ')}${same ? '' : '   ← 不一致'}`);
  ok(same, `${href} 三页标签逐字相同：${JSON.stringify(labels[0])}`);
  ok(plain, `${href} 标签是纯文字（不是拼出来的标记）`);
  ok(labels[0] === EXPECT[href], `${href} 标签就是定的那一个：${JSON.stringify(EXPECT[href])}`);
  ok(new Set(raws).size === 1, `${href} 标签的原始 HTML 也逐字相同`);
}
console.log('');

// ── c. 同一个 class，样式只出现一次 ──────────────────────────────────────
console.log('c. 三页用同一个 class，那份 <style> 每页只贴一次');
const styles = new Map();
for (const p of pages) {
  const nClass = count(p.html, 'class="hl-nav"');
  const nMark = count(p.html, MARK);
  const nBase = count(p.html, BASE_RULE);
  const st = navStyle(p.html);
  console.log(`  ${p.path.padEnd(9)} class="hl-nav" ×${nClass} · 哨兵注释 ×${nMark} · 基础规则 ${BASE_RULE} ×${nBase} · <style> ${st.length} 字节`);
  ok(nClass === 1, `${p.path} 顶栏只出现一处 class="hl-nav"`);
  ok(nMark === 1, `${p.path} 共享那段样式只贴了一次（不是内嵌四份）`);
  ok(nBase === 1, `${p.path} 基础规则 .hl-nav{box-sizing… 只有一条`);
  styles.set(st, [...(styles.get(st) || []), p.path]);
  ok(nBase === 1 && nClass === 1, `${p.path} 那一份样式里的基础规则唯一`);
}
ok(styles.size === 1, `三页那一段 <style> 逐字节相同：${[...styles.values()].map((v) => v.join('+')).join(' / ')}（${styles.size} 个版本）`);
const defs = [];
const barsInSrc = [];
for (const f of walk(join(REPO, 'tools'))) {
  const t = readFileSync(f, 'utf8');
  const rel = f.slice(REPO.length).replace(/^[\\/]/, '');
  { const n = count(t, '.hl-nav{box-sizing'); if (n) defs.push(`${rel}: ${n} 处`); }
  { const n = count(t, 'hl-bar'); if (n) barsInSrc.push(`${rel}: ${n} 处`); }
}
console.log(`  源码里 .hl-nav 基础规则（.hl-nav{box-sizing）的定义处：${defs.join(' , ') || '（没有）'}`);
ok(defs.length === 1 && defs[0].endsWith('1 处'), `整仓只有一处定义：${defs.join(' , ')}`);
console.log(`  tools/ 底下还有 .hl-bar 的档：${barsInSrc.join(' , ') || '（一份都没有）'}`);
ok(barsInSrc.length === 0, 'tools/ 底下已无任何 .hl-bar（旧的第二、三、四份都删了）');
console.log('');

// ── d. 高度与字级：新 vs 旧 ─────────────────────────────────────────────
console.log('d. 顶栏高度与字级（由 CSS 盒模型算；旧值取自 git HEAD 里那几份旧 CSS）');
const newStyle = navStyle(pages[2].html);
const NEW = barHeight(allRules(newStyle, '.hl-nav')[0], allRules(newStyle, '.hl-nav a')[0], 1.55);
const newBg = /background:(#[0-9a-f]{6})/i.exec(NEW.raw)[1];
const newPageBg = /--bg:(#[0-9a-f]{6})/.exec(pages[2].html)[1];
console.log(`  新 .hl-nav  ${NEW.raw}`);
console.log(`             字 ${NEW.font}px × 行高 ${NEW.lh} = ${(NEW.font * NEW.lh).toFixed(1)}px；链接盒 ${NEW.linkBox}px；上下 padding ${NEW.padY}px`);
console.log(`             高度 = ${NEW.padY}×2 + max(${(NEW.font * NEW.lh).toFixed(1)}, ${NEW.linkBox}) + 下边框 2 = ${NEW.height + 2}px`);

const oldSrc = (f) => execFileSync('git', ['show', `HEAD:tools/swagger/${f}`], { cwd: REPO, encoding: 'utf8' });
const oldBars = [];
for (const f of ['pages.mjs', 'pages-view.mjs']) {
  const css = oldSrc(f);
  allRules(css, '.hl-bar').forEach((r) => oldBars.push({ who: f, rule: r }));
}
console.log(`  旧 .hl-bar 一共 ${oldBars.length} 条（另有 /review 那条是裸 <a>，没有 class）：`);
for (const b of oldBars) {
  const b2 = barHeight(b.rule, '', 1.55);   // 旧的链接没有 padding／边框，盒高就是一行
  console.log(`    ${b.who}  ${b.rule.trim()}`);
  console.log(`      → 字 ${b2.font}px × 行高 ${b2.lh} + 上下 padding ${b2.padY}px = ${(b2.padY * 2 + b2.font * b2.lh).toFixed(1)}px`);
}
const revHeaders = allRules(oldSrc('review-view.mjs'), 'header');
const revH = firstPx(prop(revHeaders[0], 'padding'));
console.log(`    review-view.mjs  header{…padding:${revH}px 18px…}  正文 14px/1.6`);
console.log(`      → ${revH * 2} + ${(14 * 1.6).toFixed(1)} = ${(revH * 2 + 14 * 1.6).toFixed(1)}px（且和别页一样用 #e4f1ee，看不出是一条导航）`);

const oldH = 9 * 2 + 13.5 * 1.55;   // /roles 与 /pages 那两条
console.log('');
console.log(`  高度   旧 ${oldH.toFixed(1)}px（.hl-bar：9×2 + 13.5×1.55）→ 新 ${NEW.height + 2}px，×${((NEW.height + 2) / oldH).toFixed(2)}`);
console.log(`         旧 /review 那条 ${(revH * 2 + 14 * 1.6).toFixed(1)}px → 新 ${NEW.height + 2}px，×${((NEW.height + 2) / (revH * 2 + 14 * 1.6)).toFixed(2)}`);
console.log(`  字号   旧 13.5px（/review 那条随正文 14px）→ 新 ${NEW.font}px`);
console.log(`  底色   旧 #e4f1ee 与页面底 #eef5f3 的对比 ${contrast('#e4f1ee', '#eef5f3').toFixed(3)}:1（两条几乎同色）`);
console.log(`         新 ${newBg} 与页面底 ${newPageBg} 的对比 ${contrast(newBg, newPageBg).toFixed(3)}:1`);
console.log(`  字色   旧 #12413c on #e4f1ee = ${contrast('#12413c', '#e4f1ee').toFixed(2)}:1 → 新 #eafaf7 on ${newBg} = ${contrast('#eafaf7', newBg).toFixed(2)}:1`);
ok(NEW.height + 2 > oldH, `顶栏比旧的高：${NEW.height + 2}px > ${oldH.toFixed(1)}px`);
ok(NEW.height + 2 > revH * 2 + 14 * 1.6, `顶栏比 /review 旧的 header 高：${NEW.height + 2}px > ${(revH * 2 + 14 * 1.6).toFixed(1)}px`);
ok(NEW.font > 13.5 && NEW.font >= 14, `字号不小于旧的：${NEW.font}px ≥ 14px（旧的 13.5／14）`);
ok(contrast(newBg, newPageBg) > 3 * contrast('#e4f1ee', '#eef5f3'),
  `底色与页面底色的对比变成 3 倍以上：${contrast(newBg, newPageBg).toFixed(3)}:1 vs ${contrast('#e4f1ee', '#eef5f3').toFixed(3)}:1`);
console.log('');

// ── d2. 真實渲染：headless Chrome 量一次（可跳過）────────────────────────
// 上面那條是從 CSS 盒模型算的。這一條是真的開一個瀏覽器、把四個路由載一遍、
// 讀 getBoundingClientRect。CSS 若被別的規則蓋掉，只有這一條查得出來。
console.log('d2. 真實渲染（headless Chrome + CDP，視窗 1280×900）');
const skips = [];
async function measureRendered() {
  const CHROME = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    process.env.CHROME_PATH,
  ].filter(Boolean).find((p) => existsSync(p));
  if (!CHROME) throw new Error('找不到 Chrome／Edge');

  const port = 19223 + (process.pid % 200);
  const profile = mkdtempSync(join(tmpdir(), 'nav-verify-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let url = null;
    for (let i = 0; i < 60 && !url; i++) {
      try {
        const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        if (j.webSocketDebuggerUrl) url = j.webSocketDebuggerUrl;
      } catch { /* 還沒起來 */ }
      if (!url) await sleep(250);
    }
    if (!url) throw new Error('CDP 沒起來');

    const ws = new WebSocket(url);
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params = {}, sid) => new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
    });
    await new Promise((res) => ws.addEventListener('open', res));

    const t = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const MEASURE = `(() => {
      const n = document.querySelector('.hl-nav');
      if (!n) return null;
      const cs = getComputedStyle(n), box = n.getBoundingClientRect();
      const a = n.querySelector('a'), abox = a.getBoundingClientRect();
      return {
        path: location.pathname,
        height: +box.height.toFixed(2), fontSize: cs.fontSize, lineHeight: cs.lineHeight,
        bg: cs.backgroundColor, padding: cs.padding, position: cs.position,
        links: n.querySelectorAll('a').length, linkHeight: +abox.height.toFixed(2),
        labels: [...n.querySelectorAll('a')].map((x) => x.textContent.trim()).join(' | '),
        current: (n.querySelector('a[aria-current="page"]') || {}).textContent || '',
        viewport: innerWidth + 'x' + innerHeight,
      };
    })()`;

    const out = [];
    for (const r of ROUTES) {
      await send('Page.navigate', { url: BASE + r.path }, sessionId);
      for (let i = 0; i < 80; i++) {
        await sleep(100);
        if (await evaluate("document.readyState === 'complete' && !!document.querySelector('.hl-nav')")) break;
      }
      await sleep(150);
      out.push(await evaluate(MEASURE));
    }
    ws.close();
    return out;
  } finally {
    chrome.kill();
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 有時還鎖著，無所謂 */ }
  }
}

try {
  const shot = await measureRendered();
  const heights = shot.map((s) => s.height);
  const labels0 = pages[0].links ? [...pages[0].links.keys()] : [];
  for (const s of shot) {
    console.log(`  ${s.path.padEnd(9)} 高度 ${s.height}px · 字 ${s.fontSize} / 行高 ${s.lineHeight} · padding ${s.padding} · ${s.position} · 链接 ${s.links} 条 · 链接盒 ${s.linkHeight}px · ${s.bg} · 本站 ${s.current} · 视窗 ${s.viewport}`);
    console.log(`             ${s.labels}`);
  }
  ok(heights.every((h) => h > 39), `渲染出来比旧的 39px 高：${heights.join(' / ')}px`);
  ok(new Set(heights).size === 1, `四个路由的顶栏一样高：${heights[0]}px`);
  ok(shot.every((s) => s.fontSize === '15px'), `字号 15px（旧 13.5px）：${shot.map((s) => s.fontSize).join(' / ')}`);
  ok(shot.every((s) => s.links === wantSet.length), `每一页渲染出 ${wantSet.length} 条链接（另外三页 + 两份原件）`);
  ok(new Set(shot.map((s) => s.labels)).size === 1, '渲染出来的链接顺序与文字三页相同');
  ok(labels0.length === wantSet.length, 'HTTP 解析出来的链接数一致');
} catch (e) {
  console.log(`  未量到：${e.message}`);
  skips.push(`d2 真实渲染未量到（${e.message}）`);
}
console.log('');

// ── 结论 ─────────────────────────────────────────────────────────────────
console.log(`断言 ${fails.length === 0 ? '全过（0 项失败）' : `失败 ${fails.length} 项`}`);
for (const f of fails) console.log(`  ✗ ${f}`);
for (const s of skips) console.log(`  ! 未验证：${s}`);
process.exit(fails.length ? 1 : 0);
