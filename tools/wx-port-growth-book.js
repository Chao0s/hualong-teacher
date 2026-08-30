#!/usr/bin/env node
/**
 * 把原型的 screens/growth-book-render.js 转成小程序能用的模块。
 *
 * 这个模块 662 行，一半是纯逻辑（配置读写、目录、就绪判定、分页规划），
 * 一半是把内容拼成 HTML 字符串。后者小程序渲染不了，要改写成 wxml，
 * 所以这一步只搬逻辑那一半，HTML 那一半整块删掉，等预览页重做时再补。
 *
 * 只改三处：
 *   1. localStorage 换成 wx 的同步存储；
 *   2. 删掉产 HTML 的函数（连同它们依赖的 escapeText）；
 *   3. 末尾补 module.exports —— 原型里这些都挂在全局。
 * 其余一字未动。
 *
 *   node tools/wx-port-growth-book.js
 */

const fs = require('fs');
const path = require('path');

const SRC = 'D:/hualong-teacher/captures/_extracted/growth-book.growth-book-render.js';
const OUT = path.join(__dirname, '..', 'wx-test-home', 'utils', 'growth-book.js');

// 产 HTML 的函数，按起始行号删到下一个顶层定义之前
const DROP = [
  'escapeText', 'runsToHtml', 'bookMiniRadar', 'taskBlock', 'materialBlock',
  'widgetStyle', 'widgetPreviewText', 'customPage', 'bookSection', 'coverPage',
  'regularPage', 'schoolIntroPage', 'titlePage', 'tocPage',
  'buildBookPlan', 'buildBookPages', 'initBookViewer',
];

const lines = fs.readFileSync(SRC, 'utf8').split('\n');

// 顶层定义的行号，用来算每个函数到哪一行结束
const topLevel = [];
lines.forEach((line, i) => {
  const m = line.match(/^(?:function|const|let|var) ([A-Za-z_][A-Za-z0-9_]*)/);
  if (m) topLevel.push({ name: m[1], line: i });
});

const drop = new Set();
DROP.forEach((name) => {
  const at = topLevel.findIndex((d) => d.name === name);
  if (at < 0) throw new Error(`没找到 ${name}`);
  const start = topLevel[at].line;
  const end = at + 1 < topLevel.length ? topLevel[at + 1].line : lines.length;
  for (let i = start; i < end; i += 1) drop.add(i);
});

let out = lines.filter((_, i) => !drop.has(i)).join('\n');

// localStorage → wx 存储。小程序的 Storage 直接存对象，取不到时返回空串。
out = out
  .replace('const saved = JSON.parse(localStorage.getItem(BOOK_STORE_KEY));',
    'const saved = wx.getStorageSync(BOOK_STORE_KEY) || null;')
  .replace('try { localStorage.setItem(BOOK_STORE_KEY, JSON.stringify(config)); } catch (e) {}',
    'try { wx.setStorageSync(BOOK_STORE_KEY, config); } catch (e) {}');

// buildBookPlan 原本 90% 是数据逻辑，只有传给 addBody 的 content 是 HTML 串。
// 这里换成数据描述（kind + 料），函数就变纯了：页数估算现在能用，
// 将来预览页按 kind 渲染 wxml 也能用。分页和目录的算法一字未改。
const PLAN = `
/**
 * 排布整本册子 —— 改写自原型的 buildBookPlan。
 *
 * 原版每页的 content 是拼好的 HTML 串，小程序渲染不了。这里改成数据描述：
 *   { kind: 'custom',   item, pageIndex }  自定义栏目的第 n 页
 *   { kind: 'activity', item, source }     一条在园时光或亲子时光活动
 *   { kind: 'section',  section }          教师评估、五大领域、学期寄语等固定栏目
 *   { kind: 'empty' }                      该栏目尚未整理入册活动
 * 分页规则、目录层级和兜底逻辑都照原样搬，只把「拼 HTML」换成「记下要渲染什么」。
 */
function buildBookPlan(name, config, child) {
  const body = [], toc = [];
  const addBody = (sectionKey, title, content, tocLevel, tocTitle) => {
    const bodyIndex = body.length;
    body.push({ sectionKey, title, content });
    if (tocLevel) toc.push({ level: tocLevel, title: tocTitle || title, bodyIndex });
    return bodyIndex;
  };
  const sections = bookSections(config);
  sections.forEach(section => {
    if (section.custom) {
      const item = section.item || (config.custom || []).find(entry => entry.id === section.key);
      const count = sectionPages(item);
      for (let p = 0; p < count; p++) {
        addBody(section.key, item.name, { kind: 'custom', item, pageIndex: p }, p === 0 ? 1 : 0, item.name);
      }
      return;
    }
    if (section.key === 'time') {
      const topics = orderedTimeTopics(config.timeTopics, config.material);
      const parentMoments = (config.momentMaterial || []).filter(item => !child || !item.childId || item.childId === child.id);
      const materials = (config.material || []).map(item => {
        const sourceId = item.momentId || item.id;
        const parent = parentMoments.find(candidate => (candidate.momentId || candidate.id) === sourceId);
        return { ...item, photos: Array.from(new Set([...(item.photos || []), ...((parent && parent.photos) || [])])),
          hasChildContent: (item.photos || []).length > 0 || !!parent };
      }).filter(item => item.hasChildContent);
      let added = 0;
      topics.forEach(topic => {
        const items = materials.filter(item => item.topicId === topic.id).sort((a, b) => materialDateValue(a) - materialDateValue(b));
        if (!items.length) return;
        const first = body.length;
        items.forEach(item => addBody('time', item.title, { kind: 'activity', item, source: 'time' }, 2, item.title));
        toc.push({ level: 1, title: topic.title, bodyIndex: first, beforeChildren: true });
        added += items.length;
      });
      toc.sort((a, b) => a.bodyIndex - b.bodyIndex || (a.level - b.level));
      if (!added) addBody('time', '在园时光', { kind: 'empty' }, 1);
      return;
    }
    if (section.key === 'task') {
      const perChild = child && config.taskSelections && config.taskSelections[child.id];
      const taskIds = Array.isArray(perChild) ? perChild
        : (config.taskItems || []).filter(item => item.included).sort((a, b) => a.sort - b.sort).map(item => item.id);
      const tasks = taskIds.map(id => BOOK_TASKS.find(item => item.id === id)).filter(Boolean);
      const first = body.length;
      if (tasks.length) tasks.forEach(item => addBody('task', item.title, { kind: 'activity', item, source: 'task' }, 2, item.title));
      else addBody('task', '亲子时光', { kind: 'empty' }, 0);
      toc.push({ level: 1, title: '亲子时光', bodyIndex: first, beforeChildren: true });
      toc.sort((a, b) => a.bodyIndex - b.bodyIndex || (a.level - b.level));
      return;
    }
    addBody(section.key, section.name, { kind: 'section', section }, 1);
  });

  /* 目录必须覆盖全部正文。固定尾部栏目不能因为前面活动过多而漏掉，这里按实际 body 兜一次底。 */
  ['term', 'comp', 'message'].forEach(sectionKey => {
    const bodyIndex = body.findIndex(item => item.sectionKey === sectionKey);
    if (bodyIndex < 0 || toc.some(entry => entry.bodyIndex === bodyIndex && entry.level === 1)) return;
    toc.push({ level: 1, title: BOOK_COMPONENTS[sectionKey], bodyIndex });
  });
  toc.sort((a, b) => a.bodyIndex - b.bodyIndex || a.level - b.level);

  const tocPageCount = Math.max(1, Math.ceil(toc.length / 16));
  const frontCount = 1 + 1 + 1 + tocPageCount;   // 封面 + 办园介绍 + 扉页 + 目录
  toc.forEach(entry => { entry.page = frontCount + entry.bodyIndex + 1; });
  const taskCount = child && config.taskSelections && Array.isArray(config.taskSelections[child.id])
    ? config.taskSelections[child.id].length
    : (config.taskItems || []).filter(item => item.included).length;
  const customCount = (config.custom || []).filter(item => item.enabled !== false && (!child || sectionFilled(item, child.id) > 0)).length;
  const parentRecords = taskCount + customCount + (config.momentMaterial || []).filter(item => !child || !item.childId || item.childId === child.id).length;
  const teacherRecords = (config.material || []).filter(item => (item.photos || []).length > 0).length + 2;
  const totalPages = frontCount + body.length + 1;   // 再加一页封底

  const front = [{ kind: 'cover', cover: SCHOOL_COVER }, { kind: 'schoolIntro' },
    { kind: 'title', totalPages, parentRecords, teacherRecords }];
  Array.from({ length: tocPageCount }, (_, i) => toc.slice(i * 16, (i + 1) * 16))
    .forEach((chunk, i) => front.push({ kind: 'toc', entries: chunk, part: i + 1, totalParts: tocPageCount }));

  return { front, body, toc, totalPages };
}
`;

const kept = topLevel.map((d) => d.name).filter((n) => !DROP.includes(n)).concat('buildBookPlan');

const header = `/**
 * 成长册共用逻辑 —— 搬自原型 screens/growth-book-render.js。
 *
 * 原模块 662 行，一半纯逻辑、一半把内容拼成 HTML 字符串。
 * 小程序渲染不了 HTML 串，所以产 HTML 的那 ${DROP.length} 个函数整块没搬：
 *   ${DROP.join(', ')}
 * 成长册预览那三页要用 wxml 重做这部分，届时再在这里补回数据版的规划函数。
 *
 * 搬过来的部分只改了两处，其余一字未动：
 *   1. localStorage 换成 wx.getStorageSync / wx.setStorageSync；
 *   2. 末尾补 module.exports —— 原型里这些都挂在全局。
 */

`;

fs.writeFileSync(OUT, header + out.trim() + '\n' + PLAN + '\nmodule.exports = {\n  ' + kept.join(',\n  ') + ',\n};\n', 'utf8');
console.log(`原模块 ${lines.length} 行 → 搬出 ${lines.length - drop.size} 行，删掉 ${drop.size} 行 HTML 生成代码`);
console.log(`导出 ${kept.length} 个：${kept.join(' ')}`);
