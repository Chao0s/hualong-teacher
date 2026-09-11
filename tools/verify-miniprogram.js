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

// 7) 《指南》124 题的量表在本仓库**只有一份**，且没有第二份。
//
//    2026-09-09 之前是两份加一份（#20）：权威在 `data/guide-scale.json`，页面旁边一份
//    抄本 `questions.js`，`utils/assessment-store.js` 里还有第三份（124 个题号与名称）。
//    这里那道旧闸门只比前两份，且只比「提问」与「三档锚点」两样 —— 另外七个字段可以
//    静默漂开，包括 H1-1-1 参考表那六行数字，而那是这一题唯一的计分依据。
//
//    现在权威整份搬进 `miniprogram/data/guide-scale.js`（用 `.js` 是因为小程序的模块
//    系统只解析 `.js`），两份抄本删掉。所以这一段不再是「比两份」，是**钉住只有一份**：
//
//      A. 权威读得出来，且 `instrument.counts` 与实际树逐个相符
//      B. 摊平后的形状是页面要的那一套，每题都有提问与三档锚点
//      C. **第二份不许再出现** —— questions.js 不存在，assessment-store 不内嵌题库
//
//    C 是这一段的要害。A 与 B 只证明这一份是好的，C 才证明它是唯一的一份。
//    CLAUDE.md §7.3：一份复制品不是冗余，是一次静默过期。
//
//    跨仓库那一份（后端 `db/rubric/guide-scale-v1.json`）不在这道闸门里 ——
//    跨仓库比对要先解决「两个仓库各在什么版本」，暂未做。
console.log('[7] 《指南》量表只有一份');
{
  const SCALE_JS = ROOT + 'data/guide-scale.js';
  const OLD_COPY = ROOT + 'pages/comprehensive-assessment-form/questions.js';
  const STORE = ROOT + 'utils/assessment-store.js';

  // C：第二份不许再出现
  let dupes = 0;
  if (fs.existsSync(OLD_COPY)) {
    bad('pages/comprehensive-assessment-form/questions.js 又出现了 —— 题库只能有一份，改 data/guide-scale.js');
    dupes += 1;
  }
  if (fs.existsSync(STORE) && /const\s+ASSESS_SCALE\s*=\s*\[/.test(fs.readFileSync(STORE, 'utf8'))) {
    bad('assessment-store.js 又内嵌了 ASSESS_SCALE —— 它该从 ../data/guide-scale 派生');
    dupes += 1;
  }

  if (!fs.existsSync(SCALE_JS)) {
    bad(`找不到权威题库 ${SCALE_JS}`);
  } else {
    const mod = require(require('path').resolve(SCALE_JS));
    const { SCALE, flatDomains } = mod;

    // A：instrument.counts 与实际树逐个相符
    const counts = (SCALE.instrument || {}).counts || {};
    const actual = { domains: 0, aspects: 0, goals: 0, items: 0, likert_items: 0, measurement_items: 0 };
    for (const d of SCALE.domains || []) {
      actual.domains += 1;
      for (const a of d.aspects || []) {
        actual.aspects += 1;
        for (const g of a.goals || []) {
          actual.goals += 1;
          for (const it of g.items || []) {
            actual.items += 1;
            if (it.item_type === 'measurement') actual.measurement_items += 1;
            else actual.likert_items += 1;
          }
        }
      }
    }
    for (const k of Object.keys(actual)) {
      if (counts[k] !== actual[k]) bad(`instrument.counts.${k} 写 ${counts[k]}，实际 ${actual[k]}`);
    }

    // B：摊平后的形状是页面要的那一套
    const flat = flatDomains();
    if (flat.length !== actual.domains) bad(`flatDomains 回 ${flat.length} 个领域，实际 ${actual.domains}`);
    let n = 0;
    let shapeBad = 0;
    for (const d of flat) {
      if (!d.id || !d.name || !Array.isArray(d.items)) { bad(`领域 ${d.id} 的形状不对`); shapeBad++; continue; }
      for (const it of d.items) {
        n += 1;
        if (!it.id || !it.name || !it.q) { bad(`${it.id} 缺题号／名称／提问`); shapeBad++; continue; }
        for (const k of ['1', '3', '5']) {
          if (!((it.a || {})[k])) { bad(`${it.id} 缺 ${k} 分锚点`); shapeBad++; }
        }
      }
    }
    if (n !== actual.items) bad(`摊平后 ${n} 题，权威树 ${actual.items} 题`);
    console.log(`  ${n} 题（${flat.map((d) => d.name + d.items.length).join(' ')}），形状不对 ${shapeBad} 处；第二份 ${dupes} 处`);
  }
}

// 8) tools/ 自己的语法
//
// 为什么加这一段：2026-09-11 改了 tools/swagger/pages-view.mjs 之后，`check-all` 十步全绿、
// 这一段之前的七段也全过 —— **而页面根本渲染不出来**，因为那个文件里 `const label` 声明了两次。
// 两个后端检查器读的是 TSV，本文件此前只查 `miniprogram/` 的语法，**谁都不加载 tools/ 下的模块**，
// 所以一个 SyntaxError 能穿过全部闸门，只在真起服务渲染时炸。
// 探针（tools/probe-*.mjs）会加载 services/utils，但它们在 `npm test` 之外，且不覆盖 swagger 这一层。
//
// 2026-09-12 又咬了一次，咬在**这个检查自己漏掉的地方**：做按屏检测技能时，
// `.claude/skills/hualong-api-test/layers/proto.mjs` 少了一个收尾花括号，
// 而这一段的目录清单里没有 `.claude/skills` —— 于是它照样全绿。
// 所以下面改成**递归**扫：新增目录不用回来改这份清单，也就不会再漏。
console.log('[8] tools/ 与 .claude/skills 下的 JS 语法');
{
  const { spawnSync } = require('child_process');
  const roots = ['tools', 'scripts', path.join('.claude', 'skills')];
  const files = [];
  const walk = (rel) => {
    const abs = path.join(__dirname, '..', rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = path.join(rel, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(next); }
      else if (/\.(mjs|js)$/.test(e.name)) files.push(next);
    }
  };
  for (const r of roots) walk(r);
  let ok = 0;
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', path.join(__dirname, '..', f)], { encoding: 'utf8' });
    if (r.status !== 0) bad(`${f}: ${(r.stderr || '').split('\n').find((l) => /Error|error/.test(l)) || '语法不通过'}`);
    else ok++;
  }
  console.log(`  ${files.length} 个文件，${ok} 个通过语法检查`);
}

// 9) 登录页的行为
//
// 为什么加这一段：`tools/check-login-page.mjs` 起先是一份写在 %TEMP% 的一次性夹具 ——
// **团队重跑不到的东西不算验证**。它把未经修改的 page 装进 vm、只桩 wx 与两支 utils，
// 验三条出口（已登录不重发登录／409 才亮手机号／503 走安全阻断文案）。
// 它不联网，所以与 tools/probe-*.mjs 那一族分开命名。
console.log('[9] 登录页行为');
{
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-login-page.mjs')], { encoding: 'utf8' });
  const tail = (s) => (s || '').trim().split('\n').filter(Boolean).pop() || '';
  const out = tail(r.stdout);
  if (r.status !== 0) {
    // 页面加载就崩时最后一句话在 stderr（栈顶那一行）——只读 stdout 会得到一条空消息，
    // 而「✗ ... 失败：（空）」比没有更坏：看不出坏在哪。
    const err = (r.stderr || '').trim().split('\n').find((l) => /Error|error|✗|x /.test(l)) || tail(r.stderr);
    bad(`check-login-page 失败：${out || err || `退出码 ${r.status}`}`);
  }
  console.log(`  ${out || tail(r.stderr) || '(无输出)'}`);
}

console.log(fail === 0 ? '\n=== 全部通过 ===' : `\n=== 失败 ${fail} 项 ===`);
process.exit(fail ? 1 : 0);
