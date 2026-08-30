#!/usr/bin/env node
/**
 * 把原型里的 SVG 图标编成 base64，追加到 miniprogram 各页的 wxss 末尾。
 *
 * 为什么要这一步：小程序的 wxml 没有 <svg> 标签，图标只能当图片用；
 * 而小程序文档写明 WXSS 取不到本地图片，背景图要用网络图或 base64。
 * 网页版靠 currentColor 一份 SVG 多种颜色，背景图做不到，所以颜色烘进每份图里。
 *
 * 每个 wxss 末尾有一行 `/* ── 图标 ──…` 作为追加位置。重复执行会重复追加，
 * 要重跑先用 git 还原那几个 wxss。
 *
 *   node tools/wx-icons.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram');

// 原型里用到的颜色
const ACCENT = '#189b91';
const ACCENT_DARK = '#067e76';
const MUTED = '#868686';
const GREEN = '#4b9a5a';
const BLUE = '#3388fc';
// 原型写的是 color-mix(in oklab, var(--amber), var(--fg) 42%)，算出来约这个值
const AMBER_TEXT = '#9e6f0c';

// 图标形状，逐个抄自原型的 <svg> 内容。stroke 宽度也照抄。
const SHAPES = {
  // 底部导航
  tabHome: { w: 1.8, d: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>' },
  tabStar: { w: 1.8, d: '<path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.4 7.2 18l.9-5.4-3.9-3.8 5.4-.8L12 3z"/>' },
  tabCoord: { w: 1.8, d: (c) => `<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="1.5" fill="${c}"/><circle cx="16" cy="12" r="1.5" fill="${c}"/><circle cx="11" cy="17" r="1.5" fill="${c}"/>` },
  tabBook: { w: 1.8, d: '<path d="M4 5.5A2.5 2.5 0 016.5 3H20v16H6.5A2.5 2.5 0 014 16.5v-11z"/><path d="M8 7h8M8 11h8M8 15h5"/>' },
  tabUsers: { w: 1.8, d: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>' },

  // 首页常用入口
  quickMoments: { w: 1.8, d: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/>' },
  quickMonthly: { w: 1.8, d: '<path d="M12 3v18"/><path d="M5 8h14"/><path d="M7 13h10"/><path d="M9 18h6"/>' },
  quickGrid: { w: 1.8, d: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>' },

  // 搜索
  search: { w: 2, d: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },

  // 课程资源页
  hubBook: { w: 1.9, d: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5A2.5 2.5 0 014 19.5z"/>' },
  // 原型这个图标没设 stroke-linecap，`h.01` 那三个点在网页里也画不出来，这里照抄
  hubList: { w: 1.9, d: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>' },
  house: { w: 1.8, d: '<path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M9 21v-6h6v6"/>' },
  star2: { w: 1.8, d: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8-4.3-4.1 5.9-.9L12 3z"/>' },
  book3: { w: 1.8, d: '<path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/>' },
  wave: { w: 1.8, d: '<path d="M12 3v18"/><path d="M5 8c4 0 4 3 7 3s3-3 7-3"/><path d="M5 16c4 0 4-3 7-3s3 3 7 3"/>' },

  // 资源库 12 个入口
  silk: { w: 1.8, d: '<path d="M7 4h10l3 5-4 11H8L4 9l3-5z"/><path d="M8 9h8"/><path d="M10 14h4"/>' },
  embroidery: { w: 1.8, d: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M9 8a3 3 0 016 0"/><path d="M8 13h8"/>' },
  milk: { w: 1.8, d: '<path d="M5 11h14l-1.4 8H6.4L5 11z"/><path d="M8 8h8"/><path d="M9 5h6"/>' },
  honey: { w: 1.8, d: '<path d="M12 3c3 3 6 6.5 6 10a6 6 0 01-12 0c0-3.5 3-7 6-10z"/><path d="M9 14h6"/>' },
  town: { w: 1.8, d: '<path d="M4 20h16"/><path d="M6 20V8l6-4 6 4v12"/><path d="M9 20v-5h6v5"/>' },
  boat: { w: 1.8, d: '<path d="M4 14c4 3 12 3 16 0"/><path d="M6 10h12l-2 5H8l-2-5z"/><path d="M8 7h8"/>' },
  crossing: { w: 1.8, d: '<path d="M4 19h16"/><path d="M6 15h12"/><path d="M8 11h8"/><circle cx="8" cy="6" r="2"/><path d="M8 8v3"/>' },
  song: { w: 1.8, d: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
  lion: { w: 1.8, d: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/><path d="M12 8v8"/>' },
  opera: { w: 1.8, d: '<path d="M4 18c4-5 12-5 16 0"/><path d="M6 8c3 3 9 3 12 0"/><path d="M12 5v14"/>' },
  pottery: { w: 1.8, d: '<path d="M8 4h8"/><path d="M10 4c0 4-3 5-3 10a5 5 0 0010 0c0-5-3-6-3-10"/><path d="M9 14h6"/>' },

  // 教研培训页的档案入口
  user: { w: 2, d: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>' },
  bookOpen: { w: 2, d: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' },
};

// [目标 wxss, [选择器, 形状名, 描边色, 额外声明]]
const TARGETS = [
  ['components/hl-tabbar/index.wxss', [
    ['.tab__icon--home', 'tabHome', MUTED],
    ['.tab__icon--home-on', 'tabHome', ACCENT],
    ['.tab__icon--party', 'tabStar', MUTED],
    ['.tab__icon--party-on', 'tabStar', ACCENT],
    ['.tab__icon--coord', 'tabCoord', MUTED],
    ['.tab__icon--coord-on', 'tabCoord', ACCENT],
    ['.tab__icon--training', 'tabBook', MUTED],
    ['.tab__icon--training-on', 'tabBook', ACCENT],
    ['.tab__icon--family', 'tabUsers', MUTED],
    ['.tab__icon--family-on', 'tabUsers', ACCENT],
  ]],

  ['pages/home/index.wxss', [
    ['.quick-icon--training', 'tabBook', ACCENT, 'background-color: #e8f5f4;'],
    ['.quick-icon--moments', 'quickMoments', GREEN, 'background-color: #eaf5ed;'],
    ['.quick-icon--monthly', 'quickMonthly', '#c47900', 'background-color: #fff6df;'],
    ['.quick-icon--resource', 'quickGrid', BLUE, 'background-color: #e8f2fe;'],
  ]],

  ['pages/resource-center/index.wxss', [
    ['.search-bar__icon', 'search', MUTED],
    ['.hub-icon--resource', 'hubBook', ACCENT],
    ['.hub-icon--case', 'hubList', GREEN],
    ['.thumb__icon--house', 'house', ACCENT_DARK],
    ['.thumb__icon--star', 'star2', GREEN],
    ['.thumb__icon--book', 'book3', ACCENT_DARK],
    ['.thumb__icon--wave', 'wave', AMBER_TEXT],
  ]],

  ['pages/resource-library/index.wxss', [
    ['.search-bar__icon', 'search', MUTED],
    ['.entry__icon--silk', 'silk', GREEN],
    ['.entry__icon--embroidery', 'embroidery', GREEN],
    ['.entry__icon--milk', 'milk', AMBER_TEXT],
    ['.entry__icon--honey', 'honey', AMBER_TEXT],
    ['.entry__icon--hall', 'house', ACCENT_DARK],
    ['.entry__icon--town', 'town', GREEN],
    ['.entry__icon--boat', 'boat', AMBER_TEXT],
    ['.entry__icon--crossing', 'crossing', BLUE],
    ['.entry__icon--song', 'song', BLUE],
    ['.entry__icon--lion', 'lion', GREEN],
    ['.entry__icon--opera', 'opera', BLUE],
    ['.entry__icon--pottery', 'pottery', ACCENT_DARK],
  ]],

  ['pages/training-list/index.wxss', [
    ['.profile-icon--user', 'user', ACCENT_DARK],
    ['.profile-icon--book', 'bookOpen', ACCENT_DARK],
  ]],
];

function dataUri(name, color) {
  const shape = SHAPES[name];
  const body = typeof shape.d === 'function' ? shape.d(color) : shape.d;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${shape.w}">${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

let total = 0;
for (const [file, rules] of TARGETS) {
  let out = '\n';
  for (const [selector, shape, color, extra] of rules) {
    out += `${selector} {\n`;
    if (extra) out += `  ${extra}\n`;
    out += `  background-image: url("${dataUri(shape, color)}");\n}\n\n`;
  }
  fs.appendFileSync(path.join(ROOT, file), out.replace(/\n$/, ''), 'utf8');
  console.log(`${file.padEnd(38)} 追加 ${String(rules.length).padStart(2)} 条`);
  total += rules.length;
}
console.log(`---\n共 ${total} 个图标`);
