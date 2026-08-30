#!/usr/bin/env node
/** miniprogram/ 静态自检：JSON、JS 语法、页面注册、跳转目标、样式类、图标、wxml 结构。 */
const fs = require('fs'), path = require('path'), vm = require('vm');
// 从脚本自己的位置推出来，别写死盘符 —— 这个工程搬过一次家。
const ROOT = path.join(__dirname, '..', 'miniprogram') + path.sep;
let fail = 0;
const bad = (m) => { fail++; console.log('  ✗ ' + m); };

// 1) JSON
const jsons = ['app.json','sitemap.json','components/hl-tabbar/index.json'];
const app = JSON.parse(fs.readFileSync(ROOT+'app.json','utf8'));
app.pages.forEach(p => jsons.push(p + '.json'));
console.log('[1] JSON 解析');
jsons.forEach(f => { try { JSON.parse(fs.readFileSync(ROOT+f,'utf8')); } catch(e){ bad(f+': '+e.message); } });
// project.config.json 在仓库根，不在 miniprogram/ 里 —— 开发者工具开的是仓库根目录，
// 靠它的 miniprogramRoot 找到这个工程。指错了整个工程就打不开，所以连值一起查。
const PROJECT = path.join(__dirname, '..', 'project.config.json');
try {
  const cfg = JSON.parse(fs.readFileSync(PROJECT,'utf8'));
  if (cfg.miniprogramRoot !== 'miniprogram/') bad(`project.config.json 的 miniprogramRoot 是 ${cfg.miniprogramRoot}，应为 miniprogram/`);
} catch(e){ bad('project.config.json: ' + e.message); }
console.log(`  ${jsons.length + 1} 个文件，失败 ${fail}`);

// 2) 每个注册页面的四件套齐全 + JS 语法
console.log('[2] 页面四件套与 JS 语法');
let n2 = 0;
const jsFiles = ['app.js','components/hl-tabbar/index.js', ...app.pages.map(p=>p+'.js')];
app.pages.forEach(p => ['.wxml','.wxss','.js','.json'].forEach(ext => {
  n2++; if (!fs.existsSync(ROOT+p+ext)) bad('缺文件 '+p+ext);
}));
['index.wxml','index.wxss','index.js','index.json'].forEach(f => {
  n2++; if (!fs.existsSync(ROOT+'components/hl-tabbar/'+f)) bad('缺文件 components/hl-tabbar/'+f);
});
jsFiles.forEach(f => { try { new vm.Script(fs.readFileSync(ROOT+f,'utf8'),{filename:f}); } catch(e){ bad(f+': '+e.message); } });
console.log(`  ${app.pages.length} 个页面 + 1 个组件，${n2} 个文件，${jsFiles.length} 个 JS 通过语法检查`);

// 3) 跳转目标都注册过
console.log('[3] 跳转目标');
const registered = new Set(app.pages.map(p=>'/'+p));
let jumps = 0;
let templated = 0;
jsFiles.forEach(f => {
  const src = fs.readFileSync(ROOT+f,'utf8');
  for (const m of src.matchAll(/url:\s*[`'"]([^`'"\n]*)/g)) {
    const url = m[1].split('?')[0];
    if (!url.startsWith('/pages/')) continue;
    // 路径里带 ${...} 的（页面名由变量拼出来）静态查不了，单独计数
    if (url.includes('${')) { templated++; continue; }
    jumps++;
    if (!registered.has(url)) bad(`${f} 跳向未注册页面 ${url}`);
  }
});
console.log(`  ${jumps} 处跳转，全部指向 app.json 里注册过的页面`
  + (templated ? `；另有 ${templated} 处页面名由变量拼出，静态查不了` : ''));

// 4) 样式类：wxml 用到的静态类都要有规则；wxss 里的规则都要被用到
console.log('[4] 样式类');
const units = [['components/hl-tabbar/','index'], ...app.pages.map(p=>[path.dirname(p)+'/', path.basename(p)])];
let usedTotal = 0, orphan = 0;
let imported = 0;
for (const [dir, base] of units) {
  let wxml = fs.readFileSync(ROOT+dir+base+'.wxml','utf8');
  // <import src> 进来的模板里也有类名。不并进来查，模板用了没样式的类就没人发现。
  for (const m of wxml.matchAll(/<import\s+src=["']([^"']+)["']/g)) {
    const target = m[1].startsWith('/') ? ROOT + m[1].slice(1) : path.join(ROOT, dir, m[1]);
    if (fs.existsSync(target)) { wxml += '\n' + fs.readFileSync(target,'utf8'); imported++; }
    else bad(`${dir}${base}.wxml 的 <import> 指向不存在的文件: ${m[1]}`);
  }
  // 本页自己的 wxss 和 @import 进来的共用样式分开算：
  //   「用了没样式的类」要连共用的一起查，否则共用类全是误报；
  //   「有规则没被引用」只查本页自己的 —— 共用样式本来就不会被每一页用满。
  // 先去注释再找 @import：注释里写到「@import」这几个字时，
  // 去 import 的正则会一路吃到下一个分号，把后面的真规则也吃掉。
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const ownWxss = strip(fs.readFileSync(ROOT+dir+base+'.wxss','utf8'));
  const wxss = ownWxss.replace(/^\s*@import\s+['"][^'"]+['"]\s*;/gm, '');
  let shared = '';
  for (const m of ownWxss.matchAll(/^\s*@import\s+['"]([^'"]+)['"]/gm)) {
    const target = m[1].startsWith('/') ? ROOT + m[1].slice(1) : path.join(ROOT, dir, m[1]);
    if (fs.existsSync(target)) shared += '\n' + strip(fs.readFileSync(target, 'utf8'));
    else bad(`${dir}${base}.wxss 的 @import 指向不存在的文件: ${m[1]}`);
  }
  // 从每条规则的选择器里收集全部类名。只认行首那个会漏掉 `.a .b` 里的 .b。
  const classesIn = (css) => {
    const out = new Set();
    for (const rule of css.matchAll(/([^{}]+)\{/g))
      for (const cls of rule[1].matchAll(/\.([a-zA-Z0-9_-]+)/g)) out.add(cls[1]);
    return out;
  };
  const own = classesIn(wxss);
  const defined = new Set([...own, ...classesIn(shared)]);
  const stat = new Set(), dynPrefix = new Set();
  for (const m of wxml.matchAll(/(?:hover-)?class="([^"]*)"/g)) {
    const raw = m[1];
    raw.replace(/[a-zA-Z0-9_-]*(\{\{[^}]*\}\}[a-zA-Z0-9_-]*)+/g,' ').split(/\s+/).filter(Boolean).forEach(c=>stat.add(c));
    for (const d of raw.matchAll(/([a-zA-Z0-9_-]+--)\{\{/g)) dynPrefix.add(d[1]);
    // 三元里的字面量（如 {{cond ? 'tab--on' : ''}}）是真类名，但拼在类名后面的
    // 后缀表达式（如 tab__icon--{{k}}{{cond ? '-on' : ''}}）不是，前面挨着类名字符就跳过。
    for (const d of raw.matchAll(/\{\{[^}]*\}\}/g)) {
      const before = raw[d.index - 1] || ' ';
      // 前面挨着类名字符，或者紧跟在上一个 }} 后面，都是拼接用的后缀，不是独立类名
      if (/[a-zA-Z0-9_}-]/.test(before)) continue;
      // 三元的条件里也有字串（如 kind === 'cover' ? 'page--cover' : ''），那是拿来比的，
      // 不是类名。有问号就只看问号之后的两个分支。
      const q = d[0].indexOf('?');
      for (const lit of (q < 0 ? d[0] : d[0].slice(q)).matchAll(/'([a-zA-Z0-9_-]+)'/g)) {
        // 'avatar--' + tone 这种以 - 结尾的是前缀，不是完整类名
        if (lit[1].endsWith('-')) { dynPrefix.add(lit[1]); continue; }
        stat.add(lit[1]);
      }
    }
  }
  usedTotal += stat.size;
  for (const c of stat) if (!defined.has(c)) bad(`${dir}${base}.wxml 用了没样式的类 .${c}`);
  for (const p of dynPrefix) if (![...defined].some(c=>c.startsWith(p))) bad(`${dir}${base}: 动态类前缀 .${p}* 没有任何规则`);
  // class="{{expr}}" 这种整串由 js 算出来的类名，静态看不出用了哪些，
  // 出现过就不再报「未被引用」，否则全是误报。
  const opaque = /class="[^"]*(^|\s)?\{\{[^}]*\}\}\s*"/.test(wxml)
    || [...wxml.matchAll(/class="([^"]*)"/g)].some(m => /(^|\s)\{\{[^}]*\}\}(\s|$)/.test(m[1]));
  const used = [...defined].filter(c => stat.has(c) || [...dynPrefix].some(p=>c.startsWith(p)));
  const un = opaque ? [] : [...own].filter(c => !used.includes(c));
  if (un.length) { orphan += un.length; console.log(`  · ${dir}${base}.wxss 有 ${un.length} 条规则 wxml 没引用: ${un.join(', ')}`); }
}
console.log(`  ${units.length} 个单元，静态类 ${usedTotal} 个全部有样式；未被引用的规则 ${orphan} 条`
  + (imported ? `；另并入 ${imported} 处 <import> 的模板一起查` : ''));

// 5) 图标
console.log('[5] base64 图标');
let icons = 0, iconBad = 0;
for (const [dir, base] of units) {
  const wxss = fs.readFileSync(ROOT+dir+base+'.wxss','utf8');
  for (const m of wxss.matchAll(/base64,([A-Za-z0-9+/=]+)/g)) {
    icons++;
    const svg = Buffer.from(m[1],'base64').toString('utf8');
    if (!svg.startsWith('<svg') || !svg.endsWith('</svg>')) { iconBad++; bad(`${dir}${base}.wxss 图标 #${icons} 解码不是合法 SVG`); }
  }
}
console.log(`  ${icons} 个图标解码为合法 SVG，失败 ${iconBad}`);

// 6) wx:for 和 wx:else / wx:elif 不能挂在同一个节点上，编译器只报「wx:if not found」，
//    看半天看不出问题在 for 上。要分支就套一层 <block wx:else>。
console.log('[6] wx:for 与 wx:else 同节点');
let tags = 0;
const wxmls = [...units.map(([dir, base]) => dir + base + '.wxml'),
  ...fs.readdirSync(ROOT + 'templates').map(f => 'templates/' + f)];
for (const file of wxmls) {
  const src = fs.readFileSync(ROOT + file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of src.matchAll(/<([a-zA-Z-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    tags++;
    if (/\bwx:for\b/.test(m[2]) && /\bwx:(else|elif)\b/.test(m[2]))
      bad(`${file} 的 <${m[1]}> 同时写了 wx:for 和 wx:else/wx:elif`);
  }
}
console.log(`  ${wxmls.length} 个 wxml、${tags} 个标签检查过`);

console.log(fail === 0 ? '\n=== 全部通过 ===' : `\n=== 失败 ${fail} 项 ===`);
process.exit(fail ? 1 : 0);
