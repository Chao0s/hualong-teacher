/* 成长册共享数据与书本渲染（样本页 / 单个幼儿查看页 / 编辑样板页共用） */
const BOOK_COMPONENTS = {
  time: '在园时光', task: '亲子时光',
  term: '教师综合评估', comp: '五大领域评估', message: '学期寄语'
};
/* 预设栏目的固定顺序 */
const BOOK_ORDER = ['time', 'task', 'term', 'comp', 'message'];
/* 纯园所／班级级栏目：在园时光已含家长逐幼儿选片，必须进幼儿检查列。 */
const BOOK_CLASS_LEVEL = ['message'];

/* 封面归园所（W19）：db_school.book_cover，一园一份、只有 admin 能改，教师端只读 */
const SCHOOL_COVER = { layout: 'full', image: '', title: '的成长册' };

/* 模版状态（F16）：草稿可编可预览，首次发布后永久冻结 */
const COMPILATION_STATUS = { e1: '编册中', e2: '编册已锁定' };

/* F17：整册无最低页数，硬上限 200 页 */
const BOOK_PAGE_LIMIT = 200;

const BOOK_CHILDREN = [
  { id:'chen',  name:'陈小明', pages:{ intro:3,time:26,task:18,term:2,comp:2,message:1,custom:4 }, done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'li',    name:'李雨萱', pages:{ intro:3,time:32,task:20,term:0,comp:2,message:0,custom:4 }, done:{ intro:1, time:1, task:1, term:0, comp:1, message:0 } },
  { id:'zhang', name:'张力轩', pages:{ intro:3,time:22,task:0,term:0,comp:0,message:0,custom:4 }, done:{ intro:1, time:1, task:0, term:0, comp:0, message:0 } },
  { id:'wang',  name:'王子涵', pages:{ intro:3,time:58,task:41,term:2,comp:2,message:1,custom:6 }, done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'zhao',  name:'赵佳怡', pages:{ intro:3,time:126,task:68,term:2,comp:2,message:1,custom:4 }, done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'zhou',  name:'周沐阳', pages:{ intro:3,time:34,task:16,term:2,comp:2,message:1,custom:4 }, done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'sun',   name:'孙语桐', pages:{ intro:3,time:29,task:18,term:2,comp:2,message:1,custom:4 }, done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'lin',   name:'林浩然', pages:{ intro:3,time:31,task:17,term:2,comp:2,message:1,custom:4 }, done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'wu',    name:'吴若溪', pages:{ intro:3,time:27,task:19,term:2,comp:2,message:1,custom:4 }, done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'zheng', name:'郑可欣', pages:{ intro:3,time:33,task:20,term:2,comp:2,message:1,custom:4 }, done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'xu',    name:'许嘉乐', pages:{ intro:3,time:25,task:15,term:2,comp:2,message:1,custom:4 }, done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'he',    name:'何安然', pages:{ intro:3,time:30,task:18,term:2,comp:2,message:1,custom:4 }, done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } }
];

/* 亲子活动候选池：并非全部进册，由教师在编辑样板页手动勾选 */
const BOOK_TASKS = [
  { id: 't1', title: '亲子共读：我爸爸',   date: '6月20日', submitted: 5 },
  { id: 't2', title: '社区建筑里的纹样',   date: '6月12日', submitted: 4 },
  { id: 't3', title: '我会安全过街',       date: '5月28日', submitted: 5 },
  { id: 't4', title: '家庭种植角观察',     date: '5月14日', submitted: 3 },
  { id: 't5', title: '周末博物馆之行',     date: '4月26日', submitted: 2 }
];

function defaultTaskSelections() {
  const counts = [5,4,3,5,4,3,2,4,3,2,1,3];
  return Object.fromEntries(BOOK_CHILDREN.map((child, index) => [
    child.id,
    Array.from({ length: counts[index] }, (_, offset) => BOOK_TASKS[(index + offset) % BOOK_TASKS.length].id)
  ]));
}

/* ---------- widget 网格（W1a / W1b / W5 / W7 / W8 / W9 / W11 / W18） ---------- */
/* A4 直式 210×297mm：左右边距 30、上下 28.5 → 内容区 150×240mm ÷ 10mm = 15×24 格 */
const GRID = { cols: 15, rows: 24, cell: 10, marginX: 30, marginY: 28.5, pageW: 210, pageH: 297, min: 2 };

/* 内容来源登记表（W11）：粒度 / 谁填 / 能配哪种型别 / 入不入齐备判定，查这张表 */
const BINDING_KEYS = [
  { key: 'literal',        name: '教师自填文字',   types: ['text'],          collected: false },
  { key: 'collected',      name: '家长上传（征集）', types: ['image','text'], collected: true  },
  { key: 'school.intro',   name: '园所介绍',       types: ['text'],          collected: false },
  { key: 'school.term_message', name: '学期寄语',  types: ['text'],          collected: false, limit: 500 },
  { key: 'class.material', name: '成长资料',       types: ['image','text'],  collected: false },
  { key: 'child.message',  name: '教师寄语',       types: ['text'],          collected: false, limit: 300 },
  { key: 'child.term_eval',name: '期末评估',       types: ['text'],          collected: false, limit: 500 },
  { key: 'child.task',     name: '亲子活动',       types: ['image','text'],  collected: false, limit: 1000 },
  { key: 'child.assessment',name: '综合评估雷达图', types: ['image'],        collected: false }
];
const bindingOf = key => BINDING_KEYS.find(item => item.key === key);

/* literal 文字的样式调色板（园所调性，不给自由取色） */
const TEXT_COLORS = ['#1a1916', '#189b91', '#067e76', '#f6762f', '#3388fc', '#868686'];

/* literal 文字存成 run 阵列 [{t, b, i, c}]：加粗/斜体/颜色逐段套用。
   字级与对齐仍是整个组件级（config.size / config.align）—— CJK 定宽，粗斜色不改换行，
   所以 W18 的「字数上限由框推导」仍然成立；字级若逐段可改就会失效，故不开放 */
function contentRuns(content) {
  if (!content) return [];
  if (typeof content === 'string') return content ? [{ t: content }] : [];
  return Array.isArray(content) ? content.filter(run => run && run.t) : [];
}
const contentText = content => contentRuns(content).map(run => run.t).join('');
/* 计入容量的是字数，换行不算 */
const contentLength = content => contentText(content).replace(/\n/g, '').length;
const escapeText = text => text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
function runsToHtml(content) {
  return contentRuns(content).map(run => {
    let html = escapeText(run.t).replace(/\n/g, '<br>');
    if (run.b) html = `<b>${html}</b>`;
    if (run.i) html = `<i>${html}</i>`;
    if (run.c) html = `<span style="color:${run.c}">${html}</span>`;
    return html;
  }).join('') || '文字';
}

/* 文字容量由框的大小与字级即时推导，溢出从根本上不存在（W18）。留 2mm 内缩 */
function textCapacity(widget) {
  const size = (widget.config && widget.config.size) || 14;   // pt
  const charMM = size * 0.3528, lineMM = charMM * 1.5;
  const cols = Math.floor((widget.w * GRID.cell - 4) / charMM);
  const rows = Math.floor((widget.h * GRID.cell - 4) / lineMM);
  return Math.max(0, cols * rows);
}
/* 反方向（W18）：bound 型 widget 的框必须 >= 来源的字数上限，太小的框挡掉存档 */
function widgetTooSmall(widget) {
  if (widget.type !== 'text') return false;
  const bind = bindingOf(widget.binding);
  return !!(bind && bind.limit && textCapacity(widget) < bind.limit);
}
const widgetsOverlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/* 重叠一律拒绝（W6）；服务端必须重做一次校验，前端 UI 不是完整性边界 */
function overlapIds(widgets) {
  const bad = new Set();
  widgets.forEach((a, i) => widgets.slice(i + 1).forEach(b => {
    if (a.page === b.page && widgetsOverlap(a, b)) { bad.add(a.id); bad.add(b.id); }
  }));
  return bad;
}
const sectionWidgets = item => item.widgets || [];
const sectionPages = item => Math.max(1, ...sectionWidgets(item).map(w => w.page + 1), item.pages || 1);
/* 征集槽位数 = binding_key=collected 的 widget 数，不是独立可写值（W15） */
const sectionSlots = item => sectionWidgets(item).filter(w => w.binding === 'collected').length;

const BOOK_STORE_KEY = 'hualong.growth-book.v1';

const OPENING_DAY_TEXTS = [
  '第一次走进幼儿园，他紧紧牵着我的手。看到老师微笑着迎接，很快就愿意自己背着小书包进教室了。',
  '早上还有一点舍不得，放学时却兴奋地说认识了新朋友，也很喜欢教室里的积木和绘本。',
  '她认真挑选了最喜欢的水杯和姓名贴。第一天回家后，一直给我们讲老师带大家唱的新歌。',
  '从校门口的小紧张，到进班后主动和老师打招呼，这一天比我们想象中更加勇敢和从容。',
  '第一次独自在幼儿园吃午饭、睡午觉，回家后骄傲地说自己已经是会照顾自己的小朋友了。',
  '他在晨检处认真伸出小手，进教室后很快被建构区吸引。谢谢老师耐心陪伴他的第一天。',
  '她把第一幅幼儿园画作带回家，告诉我们画里有新老师、新朋友，还有今天见到的彩色滑梯。',
  '原本担心他会不适应，没想到放学时还舍不得离开。新环境带来的好奇，已经胜过了早晨的不安。',
  '这一天有期待，也有一点眼泪。谢谢老师温柔接住孩子的情绪，让第一次离开家变成安心的开始。',
  '她说幼儿园里有好吃的午点、好听的故事和愿意分享玩具的朋友。我们一起记住这个新的起点。'
];

function openingDaySection() {
  const children = BOOK_CHILDREN.slice(0, 10);
  const submissions = children.map((child, index) => ({
    childId: child.id,
    submittedBy: 'parent',
    state: 'done',
    images: [`${child.name}入园合影`, `${child.name}班级初体验`],
    text: OPENING_DAY_TEXTS[index]
  }));
  return {
    id: 'opening-day', name: '开学第一天', after: 'time', pages: 1, enabled: true,
    widgets: [
      { id:'opening-photo-1', page:0, x:0, y:0,  w:7,  h:10, type:'image', binding:'collected', content:'', config:{ fit:'cover' } },
      { id:'opening-photo-2', page:0, x:8, y:0,  w:7,  h:10, type:'image', binding:'collected', content:'', config:{ fit:'cover' } },
      { id:'opening-text',    page:0, x:0, y:12, w:15, h:8,  type:'text',  binding:'collected', content:'', config:{ size:14, align:'left' } }
    ],
    submitted: Object.fromEntries(children.map(child => [child.id, 3])),
    submissions,
    sectionStatus: 'd2',
    collectionStatus: 'c2'
  };
}

function defaultBookConfig() {
  return {
    status: 'd1',    // 仅兼容旧原型
    compilationStatus: 'e1', // 学期编册 e1=editing / e2=locked
    selected: BOOK_ORDER.slice(),
    custom: [openingDaySection()],
    material: [],    // 教师成长资料（班级级）[{ id, title, date, photos:[] }]
    timeMaterialInitialized: false,
    timeMaterialDemoVersion: 0,
    momentMaterial: [], // 家长按幼儿从在园时光选择的 book_parent 原型数据
    publishedChildren: [], // 原型持久化 b2 幼儿 id；真实来源为 db_growth_book.book_status
    taskPicked: BOOK_TASKS.map(item => item.id),
    taskItems: BOOK_TASKS.map((item, i) => ({ id:item.id, sort:i + 1, included:true })),
    taskSelections: defaultTaskSelections(),
    timeTopics: [],
    termMessage: '亲爱的孩子们，愿你们把这个春天收获的勇气、好奇与友爱带在身边，继续自在探索、快乐长大。'
  };
}
/* 旧结构（note / slots 数字 / submitted 数组）迁移到 widget 网格 */
function normalizeSection(item) {
  const widgets = Array.isArray(item.widgets) ? item.widgets : Array.from(
    { length: item.slots || 2 },
    (_, i) => ({ id: item.id + '-w' + (i + 1), page: 0, x: i % 2 ? 8 : 1, y: 2 + Math.floor(i / 2) * 8,
                 w: 6, h: 7, type: 'image', binding: 'collected', content: '', config: { fit: 'cover' } })
  );
  const slots = widgets.filter(w => w.binding === 'collected').length;
  const submitted = {};
  if (Array.isArray(item.submitted)) item.submitted.forEach(id => { submitted[id] = slots; });
  else if (item.submitted) Object.keys(item.submitted).forEach(id => { submitted[id] = item.submitted[id]; });
  return {
    id: item.id, name: item.name, after: item.after || 'time', enabled: item.enabled !== false,
    pages: item.pages || Math.max(1, ...widgets.map(w => w.page + 1)),
    widgets: widgets, submitted: submitted,
    submissions: Array.isArray(item.submissions) ? item.submissions : [],
    reminders: item.reminders && typeof item.reminders === 'object' ? item.reminders : {},
    sectionStatus: item.sectionStatus || 'd1', collectionStatus: item.collectionStatus || 'c1'
  };
}
function readBookConfig() {
  const base = defaultBookConfig();
  try {
    const saved = JSON.parse(localStorage.getItem(BOOK_STORE_KEY));
    if (saved && typeof saved === 'object') {
      if (Array.isArray(saved.selected)) base.selected = saved.selected.filter(key => BOOK_COMPONENTS[key]);
      if (saved.status === 'd2') base.status = 'd2';
      if (Array.isArray(saved.custom)) base.custom = saved.custom.map(normalizeSection);
      if (Array.isArray(saved.material)) base.material = saved.material;
      if (saved.timeMaterialInitialized === true) base.timeMaterialInitialized = true;
      if (Number.isFinite(saved.timeMaterialDemoVersion)) base.timeMaterialDemoVersion = saved.timeMaterialDemoVersion;
      if (Array.isArray(saved.momentMaterial)) base.momentMaterial = saved.momentMaterial;
      if (Array.isArray(saved.publishedChildren)) base.publishedChildren = saved.publishedChildren;
      if (Array.isArray(saved.taskPicked)) base.taskPicked = saved.taskPicked;
      if (Array.isArray(saved.taskItems)) base.taskItems = saved.taskItems;
      if (saved.taskSelections && typeof saved.taskSelections === 'object') base.taskSelections = saved.taskSelections;
      if (Array.isArray(saved.timeTopics)) base.timeTopics = saved.timeTopics;
      if (typeof saved.termMessage === 'string') base.termMessage = saved.termMessage;
      if (saved.compilationStatus === 'e2') base.compilationStatus = 'e2';
    }
  } catch (e) {}
  return base;
}
const bookPublished = config => config.compilationStatus === 'e2';
const bookChildPublished = (child, config) => (config.publishedChildren || []).includes(child.id);
/* 该幼儿在某新增栏目上已交的件数 */
const sectionFilled = (item, childId) => (item.submitted || {})[childId] || 0;
const sectionSubmission = (item, childId) => (item.submissions || []).find(entry => entry.childId === childId);
/* F17：页数含封面、固定内容、启用栏目与封底；逐幼儿预检可带服务端分栏结果 */
function bookPageEstimate(config, child) {
  const plan = buildBookPlan((child && child.name) || '示例幼儿', config, child);
  const breakdown = {};
  plan.body.forEach(page => { breakdown[page.sectionKey] = (breakdown[page.sectionKey] || 0) + 1; });
  const pages = plan.front.length + plan.body.length + 1;
  return { pages, breakdown, over: pages > BOOK_PAGE_LIMIT };
}
function writeBookConfig(config) {
  try { localStorage.setItem(BOOK_STORE_KEY, JSON.stringify(config)); } catch (e) {}
}

/* 新增栏目按 anchor_after 落位。F19 只允许 TOC 后正文 section_key
   或另一个新增栏目；后者要多跑几轮，因为锚点本身可能还没落位。 */
function placeCustoms(list, customs) {
  const pending = customs.slice();
  const entryOf = item => ({ key: item.id, name: item.name, custom: true, on: item.enabled !== false, after: item.after, item: item });
  let guard = pending.length + 1;
  while (pending.length && guard--) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const item = pending[i];
      const at = list.findIndex(section => section.key === item.after);
      if (at >= 0) { list.splice(at + 1, 0, entryOf(item)); pending.splice(i, 1); }
    }
  }
  /* 锚点已被删除或互相成环的，落到最后，不让它凭空消失 */
  pending.forEach(item => list.push(entryOf(item)));
  return list;
}
/* 预设栏目按固定顺序；新增栏目按「插在某栏目之后」落位 */
function bookSections(config) {
  const selected = new Set(config.selected || BOOK_ORDER);
  return placeCustoms(
    BOOK_ORDER.filter(key => !['time','task'].includes(key) || selected.has(key))
      .map(key => ({ key: key, name: BOOK_COMPONENTS[key], custom: false })),
    (config.custom || []).filter(item => item.enabled !== false)
  );
}
/* 编辑样板用的完整清单：固定正文 5 项 + 新增栏目按锚点落位，
   顺序即册子里的实际页序，所以行上不必再写「插在某某之后」 */
function bookOutline(config) {
  const selected = new Set(config.selected || BOOK_ORDER);
  return placeCustoms(
    BOOK_ORDER.map(key => ({
      key: key, name: BOOK_COMPONENTS[key], custom: false,
      on: !['time','task'].includes(key) || selected.has(key)
    })),
    config.custom || []
  );
}
/* 插入位置选项，按册子里的实际顺序给。
   excludeId 用于排除自己与所有锚定到自己的栏目，避免 A 在 B 之后、B 又在 A 之后的环 */
function bookAnchors(config, excludeId) {
  const blocked = new Set();
  if (excludeId) {
    blocked.add(excludeId);
    for (let grew = true; grew;) {
      grew = false;
      (config.custom || []).forEach(item => {
        if (!blocked.has(item.id) && blocked.has(item.after)) { blocked.add(item.id); grew = true; }
      });
    }
  }
  const list = [];
  bookOutline(config).forEach(section => {
    if (section.custom ? !blocked.has(section.key) : section.on) {
      list.push({ id: section.key, name: section.name + ' 之后' });
    }
  });
  return list;
}

/* 纯班级级栏目是否就绪。 */
function classLevelReady(key, config) {
  return key !== 'message' || !!String(config.termMessage || '').trim();
}
function childSectionReady(key, child, config) {
  if (key === 'time') {
    const registered = new Set((config.material || []).map(item => item.momentId || item.id));
    const teacherReady = (config.material || []).some(item => (item.photos || []).length > 0);
    const parentReady = (config.momentMaterial || []).some(item =>
      registered.has(item.momentId || item.id) && (!item.childId || item.childId === child.id));
    return teacherReady || parentReady;
  }
  if (key === 'task') return ((config.taskSelections || {})[child.id] || []).length > 0;
  return !!child.done[key];
}
/* 某幼儿是否齐备：因人而异的预设栏目 + 各新增栏目「全部槽位」都有提交（W15） */
function bookCanFinalize(child, config) {
  const sections = bookSections(config);
  if (!sections.length) return false;
  const classOk = sections.filter(s => !s.custom && BOOK_CLASS_LEVEL.includes(s.key))
    .every(s => classLevelReady(s.key, config));
  const childOk = sections.filter(s => !s.custom && !BOOK_CLASS_LEVEL.includes(s.key))
    .every(s => childSectionReady(s.key, child, config));
  const customOk = (config.custom || []).filter(item => item.enabled !== false)
    .every(item => sectionFilled(item, child.id) >= sectionSlots(item));
  return classOk && childOk && customOk && !bookPageEstimate(config, child).over;
}

function bookMiniRadar(scores) {
  const count = 5, cx = 50, cy = 50, maxR = 34;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + i * Math.PI * 2 / count;
    return [cx + Math.cos(a) * maxR * v / 5, cy + Math.sin(a) * maxR * v / 5];
  };
  const rings = [1,3,5].map(level =>
    `<polygon points="${scores.map((_, i) => pt(i, level).join(',')).join(' ')}" fill="none" stroke="#d7e4e4"/>`).join('');
  return `<svg viewBox="0 0 100 100" width="104" height="104">${rings}
    <polygon points="${scores.map((s, i) => pt(i, s).join(',')).join(' ')}"
      fill="rgba(24,155,145,.22)" stroke="#189b91" stroke-width="1.8"/></svg>`;
}

/* 亲子活动页：只渲染教师勾选收录的活动；照片按幼儿各自家庭的提交呈现 */
function taskBlock(config) {
  const picked = BOOK_TASKS.filter(item => (config.taskPicked || []).includes(item.id));
  if (!picked.length) {
    return `<p class="page-text" style="color:var(--muted)">尚未选择要收录的亲子活动。在编辑样板的「亲子活动 · 管理」中勾选后，会显示在这里。</p>`;
  }
  return picked.slice(0, 2).map(item => `
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:700">${item.title}<span style="font-weight:400;color:var(--muted)"> · ${item.date}</span></div>
      <div class="photo-2" style="margin-top:7px">
        <div class="bg-photo" style="height:80px">家长上传照片</div>
        <div class="bg-photo" style="height:80px">家长上传照片</div>
      </div>
    </div>`).join('') +
    (picked.length > 2 ? `<p class="page-text" style="color:var(--muted)">…另有 ${picked.length - 2} 次亲子活动</p>` : '');
}

/* 在园时光页：由成长资料渲染；未收录时给出提示 */
function materialBlock(config) {
  const byId = new Map();
  [...(config.material || []), ...(config.momentMaterial || [])].forEach(item => {
    const existing = byId.get(item.id);
    if (!existing) byId.set(item.id, item);
    else existing.photos = Array.from(new Set([...(existing.photos || []), ...(item.photos || [])]));
  });
  const list = Array.from(byId.values());
  if (!list.length) {
    return `<p class="page-text" style="color:var(--muted)">尚未收录成长资料。在「在园时光」或「社区共育」的动态上点「+ 加入成长册」后，会显示在这里。</p>`;
  }
  return list.slice(0, 2).map(item => `
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:700">${item.title}<span style="font-weight:400;color:var(--muted)"> · ${item.date}</span></div>
      <div class="photo-2" style="margin-top:7px">
        ${item.photos.slice(0, 2).map(label => `<div class="bg-photo" style="height:80px">${label}</div>`).join('')}
      </div>
    </div>`).join('') +
    (list.length > 2 ? `<p class="page-text" style="color:var(--muted)">…另有 ${list.length - 2} 条成长资料</p>` : '');
}

/* widget 在页面内容区里的位置：格数 → 百分比，长宽比即占格之比（W1a） */
function widgetStyle(widget) {
  return `left:${widget.x / GRID.cols * 100}%;top:${widget.y / GRID.rows * 100}%;`
    + `width:${widget.w / GRID.cols * 100}%;height:${widget.h / GRID.rows * 100}%;`;
}
/* widget 里显示什么：literal 用自填文字，其余按 binding 取来源的示意内容 */
function widgetPreviewText(widget, name) {
  if (widget.binding === 'literal') return runsToHtml(widget.content);
  const bind = bindingOf(widget.binding);
  const sample = {
    'collected': '家长提交的文字',
    'school.intro': '华龙第一幼儿园创办于 1998 年，以「生活即教育」为办园理念。',
    'class.material': '成长资料的活动文字',
    'child.message': `亲爱的${name}：这一年里，你从需要老师牵着手走进教室，到能主动招呼新来的小朋友。`,
    'child.term_eval': '本学期能稳定参与班级活动，规则意识和表达意愿持续提升。',
    'child.task': '亲子活动的家长记录'
  };
  return sample[widget.binding] || (bind ? bind.name : '');
}
/* 新增栏目的某一页：按 widget 网格实排（W3；教师预览与 App 查看同源） */
function customPage(item, pageIndex, name, child) {
  const list = sectionWidgets(item).filter(w => w.page === pageIndex);
  if (!list.length) return '<p class="page-text" style="color:var(--muted)">本页尚未放置组件。</p>';
  const submission = child ? sectionSubmission(item, child.id) : null;
  let imageIndex = 0;
  const inner = list.map(widget => {
    const cfg = widget.config || {};
    if (widget.type === 'image') {
      const collectedLabel = submission && submission.images && submission.images[imageIndex]
        ? submission.images[imageIndex] : '家长上传照片';
      if (widget.binding === 'collected') imageIndex += 1;
      return `<div class="wg-box wg-img" style="${widgetStyle(widget)}">${
        widget.binding === 'collected' ? collectedLabel : (bindingOf(widget.binding) || {}).name || '图片'}</div>`;
    }
    return `<div class="wg-box wg-text" style="${widgetStyle(widget)};font-size:${(cfg.size || 14) * 0.62}px;text-align:${cfg.align || 'left'}">${
      widget.binding === 'collected' && submission ? escapeText(submission.text || '') : widgetPreviewText(widget, name)}</div>`;
  }).join('');
  return `<div class="wg-area">${inner}</div>`;
}

function bookSection(section, name, config) {
  /* 新增栏目由 widget 网格渲染，见 customPage */
  if (section.custom) return '';
  const blocks = {
    intro: `
      <div class="bg-photo" style="height:118px">园所环境照</div>
      <p class="page-text" style="margin-top:12px">华龙第一幼儿园创办于 1998 年，以「生活即教育」为办园理念，设有种植园、建构区与阅读长廊，为幼儿提供可探索、可表达的成长环境。</p>`,
    time: materialBlock(config),
    task: taskBlock(config),
    term: `
      <p class="page-text">本学期能稳定参与班级活动，规则意识和表达意愿持续提升；在小组任务中愿意承担材料整理的角色，遇到困难时会主动寻求同伴协作。</p>
      <div class="photo-2" style="margin-top:12px">
        <div class="bg-photo" style="height:92px">期末汇报</div>
        <div class="bg-photo" style="height:92px">作品展示</div>
      </div>`,
    comp: `
      <div style="display:flex;gap:12px;align-items:center">
        ${bookMiniRadar([4.6,4.1,4.4,3.2,3.8])}
        <div style="flex:1">
          <div class="kv"><span>健康</span><b>4.6</b></div>
          <div class="kv"><span>语言</span><b>4.1</b></div>
          <div class="kv"><span>社会</span><b>4.4</b></div>
          <div class="kv"><span>科学</span><b>3.2</b></div>
          <div class="kv"><span>艺术</span><b>3.8</b></div>
        </div>
      </div>
      <p class="page-text" style="margin-top:12px">依据《3-6岁儿童学习与发展指南》教师评定量表 124 题评定，图示为五大领域均分。</p>`,
    message: `
      <p class="page-text">${config.termMessage || '本学期寄语尚未由园所填写。'}</p>
      <p class="page-text" style="margin-top:20px;text-align:right">—— 华龙第一幼儿园</p>`
  };
  return blocks[section.key] || '';
}

function coverPage(name, cover) {
  cover = cover || SCHOOL_COVER;
  const layout = cover.layout || 'full';
  const photo = cover.image
    ? `<div class="cover-photo has-img" style="background-image:url('${cover.image}')"></div>`
    : `<div class="cover-photo">封面图片</div>`;
  const text = `
    <div class="cover-text">
      <div class="page-kicker">GROWTH BOOK 2026</div>
      <h1>${name}<br>${cover.title || '的成长册'}</h1>
      <div class="sub">中二班 · 2026 春季学期<br>华龙第一幼儿园</div>
    </div>`;
  const inner = layout === 'plain' ? text
    : layout === 'stack' ? photo + text
    : layout === 'side' ? text + photo
    : photo + text;   // full
  return `
    <div class="page cover cover-${layout}">
      <div class="page-body">${inner}</div>
      <div class="page-foot"><span>封面</span><span>华龙一幼</span></div>
    </div>`;
}

function regularPage(name, title, content, physicalPage, kicker) {
  return `<div class="page"><div class="page-body">
    <div class="page-kicker">${kicker || 'GROWTH BOOK'}</div>
    <div class="page-title">${title}</div>${content}
    </div><div class="page-foot"><span>${name} · 成长册</span><span>${physicalPage}</span></div></div>`;
}

function schoolIntroPage(name, physicalPage) {
  return regularPage(name, '园所介绍', `<div class="bg-photo" style="height:118px">园所环境照</div>
    <p class="page-text" style="margin-top:12px">华龙第一幼儿园创办于 1998 年，以「生活即教育」为办园理念，设有种植园、建构区与阅读长廊，为幼儿提供可探索、可表达的成长环境。</p>`, physicalPage, 'OUR KINDERGARTEN');
}

function titlePage(name, physicalPage, totalPages, parentRecords, teacherRecords) {
  return regularPage(name, `${name}的成长册`, `<div class="kv"><span>作者</span><b>${name}爸爸妈妈、中二班老师</b></div>
    <div class="kv"><span>班级</span><b>中二班</b></div>
    <div class="kv"><span>学期</span><b>2026 年 2 月 23 日—7 月 10 日</b></div>
    <div class="kv"><span>全册页数</span><b>${totalPages} 页</b></div>
    <div class="kv"><span>成长记录</span><b>家长 ${parentRecords} 条 · 教师 ${teacherRecords} 条</b></div>
    <p class="page-text" style="margin-top:18px;color:var(--muted)">页数包含封面、扉页、目录和封底；记录按活动／提交事件计数，不按照片张数重复计算。</p>`, physicalPage, 'THIS BOOK BELONGS TO');
}

function tocPage(name, entries, physicalPage, part, totalParts) {
  const rows = entries.map(entry => `<div class="kv" style="padding-left:${entry.level === 2 ? 18 : 0}px">
    <span style="${entry.level === 1 ? 'font-weight:700' : ''}">${entry.level === 2 ? '— ' : ''}${entry.title}</span><b>${entry.page}</b></div>`).join('');
  return regularPage(name, totalParts > 1 ? `目录 ${part}/${totalParts}` : '目录', rows || '<p class="page-text">正文尚未整理。</p>', physicalPage, 'CONTENTS');
}

function activityContent(item, source) {
  const photos = (item.photos || []).slice(0, 4);
  const photoHtml = photos.length ? `<div class="photo-2" style="margin-top:10px">${photos.map((photo, i) =>
    `<div class="bg-photo" style="height:84px">${source === 'task' ? '家庭照片' : `活动照片 ${i + 1}`}</div>`).join('')}</div>` : '';
  const text = source === 'task'
    ? '孩子和家人一起完成活动，家长的文字记录与照片按正文版式穿插呈现。'
    : (item.description || '孩子们在活动中认真观察、主动表达，也在合作与尝试中留下了新的成长经验。');
  return `<p class="page-text">${text}</p>${photoHtml}`;
}

function materialDateValue(item) {
  if (item.dateValue) return Date.parse(item.dateValue) || 0;
  const match = String(item.date || '').match(/(\d+)月(\d+)日/);
  return match ? new Date(2026, Number(match[1]) - 1, Number(match[2])).getTime() : 0;
}

/* 主题顺序由其最早活动决定；越早的主题越靠前。空主题排在有活动主题之后，
   同一最早日期再以既有 sort 及 id 稳定打破平手。管理页、TOC 与正文共用。 */
function orderedTimeTopics(topics, materials) {
  const oldest = topicId => {
    const dates = (materials || []).filter(item => item.topicId === topicId)
      .map(materialDateValue).filter(value => value > 0);
    return dates.length ? Math.min(...dates) : Number.POSITIVE_INFINITY;
  };
  return [...(topics || [])].sort((a, b) =>
    oldest(a.id) - oldest(b.id) || (a.sort || 0) - (b.sort || 0) || String(a.id).localeCompare(String(b.id)));
}

/* F19：先形成完整正文页计划，再反填 TOC 物理页码。每个活动 push 自己的页，
   因而天然独立起页；未来单个活动扩成多页时只需连续 push，下一活动仍从新页开始。 */
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
        addBody(section.key, item.name, customPage(item, p, name, child), p === 0 ? 1 : 0, item.name);
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
        items.forEach(item => addBody('time', item.title, activityContent(item, 'time'), 2, item.title));
        toc.push({ level: 1, title: topic.title, bodyIndex: first, beforeChildren: true });
        added += items.length;
      });
      /* 调整刚加入的主题到其二级活动之前。 */
      toc.sort((a, b) => a.bodyIndex - b.bodyIndex || (a.level - b.level));
      if (!added) addBody('time', '在园时光', '<p class="page-text" style="color:var(--muted)">尚未整理入册活动。</p>', 1);
      return;
    }
    if (section.key === 'task') {
      const perChild = child && config.taskSelections && config.taskSelections[child.id];
      const taskIds = Array.isArray(perChild) ? perChild
        : (config.taskItems || []).filter(item => item.included).sort((a, b) => a.sort - b.sort).map(item => item.id);
      const tasks = taskIds.map(id => BOOK_TASKS.find(item => item.id === id)).filter(Boolean);
      const first = body.length;
      if (tasks.length) tasks.forEach(item => addBody('task', item.title, activityContent(item, 'task'), 2, item.title));
      else addBody('task', '亲子时光', '<p class="page-text" style="color:var(--muted)">尚未整理入册活动。</p>', 0);
      toc.push({ level: 1, title: '亲子时光', bodyIndex: first, beforeChildren: true });
      toc.sort((a, b) => a.bodyIndex - b.bodyIndex || (a.level - b.level));
      return;
    }
    addBody(section.key, section.name, bookSection(section, name, config), 1);
  });

  /* TOC 必须覆盖全部正文。固定尾部栏目不可因前面活动过多、分页或未来分支
     调整而漏掉；这里以实际 body 再做一次完整性兜底。 */
  ['term', 'comp', 'message'].forEach(sectionKey => {
    const bodyIndex = body.findIndex(item => item.sectionKey === sectionKey);
    if (bodyIndex < 0 || toc.some(entry => entry.bodyIndex === bodyIndex && entry.level === 1)) return;
    toc.push({ level: 1, title: BOOK_COMPONENTS[sectionKey], bodyIndex });
  });
  toc.sort((a, b) => a.bodyIndex - b.bodyIndex || a.level - b.level);

  const tocPageCount = Math.max(1, Math.ceil(toc.length / 16));
  const frontCount = 1 + 1 + 1 + tocPageCount;
  toc.forEach(entry => { entry.page = frontCount + entry.bodyIndex + 1; });
  const taskCount = child && config.taskSelections && Array.isArray(config.taskSelections[child.id])
    ? config.taskSelections[child.id].length
    : (config.taskItems || []).filter(item => item.included).length;
  const customCount = (config.custom || []).filter(item => item.enabled !== false && (!child || sectionFilled(item, child.id) > 0)).length;
  const parentRecords = taskCount + customCount + (config.momentMaterial || []).filter(item => !child || !item.childId || item.childId === child.id).length;
  const teacherRecords = (config.material || []).filter(item => (item.photos || []).length > 0).length + 2;
  const totalPages = frontCount + body.length + 1;
  const front = [coverPage(name, SCHOOL_COVER), schoolIntroPage(name, 2)];
  front.push(titlePage(name, front.length + 1, totalPages, parentRecords, teacherRecords));
  const chunks = Array.from({ length: tocPageCount }, (_, i) => toc.slice(i * 16, (i + 1) * 16));
  chunks.forEach((chunk, i) => front.push(tocPage(name, chunk, front.length + 1, i + 1, tocPageCount)));
  return { front, body, toc, totalPages };
}

function buildBookPages(name, config, child) {
  const plan = buildBookPlan(name, config, child);
  const pages = [...plan.front];
  plan.body.forEach(item => pages.push(regularPage(name, item.title, item.content, pages.length + 1)));
  pages.push(`<div class="page back-cover"><div class="page-body" style="display:grid;place-items:center;text-align:center"><div>
    <div class="page-title" style="color:var(--accent-dark)">愿你带着好奇，继续长大</div>
    <p class="page-text">华龙第一幼儿园 · 中二班<br>2026 年 7 月</p>
    </div></div><div class="page-foot"><span>封底</span><span>${pages.length + 1}</span></div></div>`);
  return pages;
}

/* 翻页控制：已翻过的页绕左边缘翻开并压低层级，未翻的页倒序堆叠 */
function initBookViewer(refs) {
  let pageIndex = 0, total = 0;

  function sync() {
    refs.book.querySelectorAll('.page').forEach((page, i) => {
      const flipped = i < pageIndex;
      page.classList.toggle('flipped', flipped);
      page.style.zIndex = flipped ? i : total - i;
    });
    refs.indicator.textContent = `${pageIndex + 1} / ${total}`;
    refs.prev.disabled = pageIndex === 0;
    refs.next.disabled = pageIndex === total - 1;
  }
  function turn(step) {
    const next = pageIndex + step;
    if (next < 0 || next >= total) return;
    pageIndex = next;
    sync();
  }
  function load(name, config, keepPage, child) {
    const pages = buildBookPages(name, config, child);
    const prevIndex = pageIndex;
    total = pages.length;
    pageIndex = keepPage ? Math.min(prevIndex, total - 1) : 0;
    refs.book.innerHTML = pages.join('');
    refs.book.querySelectorAll('.page').forEach((page, i) => {
      page.addEventListener('click', () => turn(i < pageIndex ? -1 : 1));
    });
    sync();
  }

  refs.prev.addEventListener('click', () => turn(-1));
  refs.next.addEventListener('click', () => turn(1));
  return { load: load, reset: () => { pageIndex = 0; sync(); }, pageCount: () => total };
}
