#!/usr/bin/env node
/**
 * 把 captures/<页面>.txt 里的 body、CSS、JS 抽成可读文件，方便逐页读着转。
 *
 * 源料已经在版本库里，转换前**不需要**重新抓站。只有原型重新部署、
 * 或者 captures/ 里确实缺页时，才用 web-capture skill 重抓。
 *
 *   node tools/wx-extract-capture.js growth-book growth-book-time-manage
 *   node tools/wx-extract-capture.js --all
 *
 * 输出到 captures/_extracted/，该目录不进版本库，随时可重建。
 * 每页产出：
 *   <页面>.body.html   去掉 <script> 的正文
 *   <页面>.style.css   页面自己的内联样式
 *   <页面>.<外链名>.css 外链样式的正文（如 home-school-common）
 *   <页面>.inlineN.js  第 N 段内联脚本
 *   <页面>.<外链名>.js  外链脚本的正文（如 growth-book-render）
 */

const fs = require('fs');
const path = require('path');

const CAPTURES = path.join(__dirname, '..', 'captures');
const OUT = path.join(CAPTURES, '_extracted');

const args = process.argv.slice(2);
if (!args.length) {
  console.error('用法: node tools/wx-extract-capture.js <页面名>... | --all');
  console.error('页面名见 captures/_index.txt');
  process.exit(1);
}

const names = args[0] === '--all'
  ? fs.readdirSync(CAPTURES).filter((f) => f.endsWith('.txt') && f !== '_index.txt').map((f) => f.replace('.txt', ''))
  : args;

fs.mkdirSync(OUT, { recursive: true });

// 外链资源用文件名当后缀，去掉扩展名
const tag = (url) => url.split('/').pop().replace(/\.(css|js)$/, '');

let pages = 0;
for (const name of names) {
  const file = path.join(CAPTURES, `${name}.txt`);
  if (!fs.existsSync(file)) {
    console.error(`✗ ${name}: captures/${name}.txt 不存在`);
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

  const body = (pkg.sourceHTML.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, ''])[1];
  fs.writeFileSync(path.join(OUT, `${name}.body.html`), body.replace(/<script[\s\S]*?<\/script>/g, '').trim(), 'utf8');

  const written = [`body ${body.length}`];
  pkg.styles.forEach((s) => {
    if (!s.content.trim()) return;
    const suffix = s.type === 'external' ? tag(s.url) : 'style';
    fs.writeFileSync(path.join(OUT, `${name}.${suffix}.css`), s.content, 'utf8');
    written.push(`${suffix}.css ${s.content.length}`);
  });
  pkg.scripts.forEach((s, i) => {
    if (!s.content.trim()) return;
    const suffix = s.type === 'external' ? tag(s.url) : `inline${i}`;
    fs.writeFileSync(path.join(OUT, `${name}.${suffix}.js`), s.content, 'utf8');
    written.push(`${suffix}.js ${s.content.length}`);
  });

  console.log(`${name.padEnd(34)} ${written.join(' | ')}`);
  pages += 1;
}

console.log(`---\n抽出 ${pages} 页到 ${OUT}`);
