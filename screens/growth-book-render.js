/* 成长册共享数据与书本渲染（样本页 / 单个幼儿查看页 / 编辑样板页共用） */
const BOOK_COMPONENTS = {
  intro: '园所介绍', time: '在园时光', task: '亲子活动',
  term: '期末评估', comp: '综合评估', message: '教师寄语'
};
/* 预设栏目的固定顺序 */
const BOOK_ORDER = ['intro', 'time', 'task', 'term', 'comp', 'message'];
/* 园所级 / 班级级栏目：全班内容相同，不进检查表的幼儿列 */
const BOOK_CLASS_LEVEL = ['intro', 'time'];

const COVER_LAYOUTS = [
  { id: 'full',   name: '满版图 + 底部文字' },
  { id: 'stack',  name: '上图下文' },
  { id: 'side',   name: '左文右图' },
  { id: 'plain',  name: '纯色居中' }
];

const BOOK_CHILDREN = [
  { id:'chen',  name:'陈小明', done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'li',    name:'李雨萱', done:{ intro:1, time:1, task:1, term:0, comp:1, message:0 } },
  { id:'zhang', name:'张力轩', done:{ intro:1, time:1, task:0, term:0, comp:0, message:0 } },
  { id:'wang',  name:'王子涵', done:{ intro:1, time:1, task:1, term:1, comp:1, message:1 } },
  { id:'zhao',  name:'赵佳怡', done:{ intro:1, time:0, task:0, term:1, comp:1, message:0 } }
];

const BOOK_STORE_KEY = 'hualong.growth-book.v1';

function defaultBookConfig() {
  return {
    selected: BOOK_ORDER.slice(),
    cover: { layout: 'full', image: '', title: '的成长册' },
    custom: [],      // [{ id, name, note, after, submitted:[childId] }]
    material: []     // 成长资料（班级级）[{ id, title, date, photos:[] }]
  };
}
function readBookConfig() {
  const base = defaultBookConfig();
  try {
    const saved = JSON.parse(localStorage.getItem(BOOK_STORE_KEY));
    if (saved && Array.isArray(saved.selected)) {
      base.selected = saved.selected.filter(key => BOOK_COMPONENTS[key]);
      if (saved.cover) Object.assign(base.cover, saved.cover);
      if (Array.isArray(saved.custom)) base.custom = saved.custom;
      if (Array.isArray(saved.material)) base.material = saved.material;
    }
  } catch (e) {}
  return base;
}
function writeBookConfig(config) {
  try { localStorage.setItem(BOOK_STORE_KEY, JSON.stringify(config)); } catch (e) {}
}

/* 预设栏目按固定顺序；新增栏目按「插在某栏目之后」落位 */
function bookSections(config) {
  const list = BOOK_ORDER
    .filter(key => config.selected.includes(key))
    .map(key => ({ key: key, name: BOOK_COMPONENTS[key], custom: false }));
  (config.custom || []).forEach(item => {
    const entry = { key: item.id, name: item.name, note: item.note, custom: true, after: item.after };
    const at = list.findIndex(section => section.key === item.after);
    if (item.after === 'cover' || at < 0) list.unshift(entry);
    else list.splice(at + 1, 0, entry);
  });
  return list;
}
/* 新增栏目的插入位置选项 */
function bookAnchors(config) {
  return [{ id: 'cover', name: '封面之后（最前）' }].concat(
    BOOK_ORDER.filter(key => config.selected.includes(key))
      .map(key => ({ id: key, name: BOOK_COMPONENTS[key] + ' 之后' }))
  );
}

/* 班级级栏目是否就绪：园所介绍恒为真，在园时光取决于成长资料是否非空 */
function classLevelReady(key, config) {
  if (key === 'time') return (config.material || []).length > 0;
  return true;
}
/* 某幼儿是否齐备：因人而异的预设栏目 + 各新增栏目的家长提交 */
function bookCanGenerate(child, config) {
  const sections = bookSections(config);
  if (!sections.length) return false;
  const classOk = sections.filter(s => !s.custom && BOOK_CLASS_LEVEL.includes(s.key))
    .every(s => classLevelReady(s.key, config));
  const childOk = sections.filter(s => !s.custom && !BOOK_CLASS_LEVEL.includes(s.key))
    .every(s => child.done[s.key]);
  const customOk = (config.custom || []).every(item => (item.submitted || []).includes(child.id));
  return classOk && childOk && customOk;
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

/* 在园时光页：由成长资料渲染；未收录时给出提示 */
function materialBlock(config) {
  const list = config.material || [];
  if (!list.length) {
    return `<p class="page-text" style="color:var(--muted)">尚未收录成长资料。在「在园时光」中点 + 将动态加入成长资料后，会显示在这里。</p>`;
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

function bookSection(section, name, config) {
  if (section.custom) {
    return `
      ${section.note ? `<p class="page-text" style="margin-bottom:12px">${section.note}</p>` : ''}
      <div class="photo-2">
        <div class="bg-photo" style="height:110px">家长上传照片</div>
        <div class="bg-photo" style="height:110px">家长上传照片</div>
      </div>
      <p class="page-text" style="margin-top:12px;color:var(--muted)">本栏目照片由家长通过「成长册素材征集」提交。</p>`;
  }
  const blocks = {
    intro: `
      <div class="bg-photo" style="height:118px">园所环境照</div>
      <p class="page-text" style="margin-top:12px">华龙第一幼儿园创办于 1998 年，以「生活即教育」为办园理念，设有种植园、建构区与阅读长廊，为幼儿提供可探索、可表达的成长环境。</p>`,
    time: materialBlock(config),
    task: `
      <div class="photo-2">
        <div class="bg-photo" style="height:96px">亲子共读</div>
        <div class="bg-photo" style="height:96px">社区探访</div>
      </div>
      <p class="page-text" style="margin-top:12px">参与亲子任务 8 次，家长上传作品 14 份，其中「社区建筑里的纹样」获班级展示。</p>`,
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
      <p class="page-text">亲爱的${name}：<br><br>这一年里，你从需要老师牵着手走进教室，到能主动招呼新来的小朋友。你在种植角记录蚕豆发芽的样子，认真得让老师惊喜。愿你继续保持这份好奇，去发现更多有趣的事。</p>
      <p class="page-text" style="margin-top:20px;text-align:right">—— 中二班 李老师</p>`
  };
  return blocks[section.key] || '';
}

function coverPage(name, cover) {
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

function buildBookPages(name, config) {
  const sections = bookSections(config);
  const pages = [coverPage(name, config.cover || {})];
  sections.forEach((section, i) => {
    pages.push(`
      <div class="page">
        <div class="page-body">
          <div class="page-kicker">${String(i + 1).padStart(2, '0')}</div>
          <div class="page-title">${section.name}</div>
          ${bookSection(section, name, config)}
        </div>
        <div class="page-foot"><span>${name} · 成长册</span><span>${i + 2}</span></div>
      </div>`);
  });
  pages.push(`
    <div class="page back-cover">
      <div class="page-body" style="display:grid;place-items:center;text-align:center">
        <div>
          <div class="page-title" style="color:var(--accent-dark)">愿你带着好奇，继续长大</div>
          <p class="page-text">华龙第一幼儿园 · 中二班<br>2026 年 7 月</p>
        </div>
      </div>
      <div class="page-foot"><span>封底</span><span></span></div>
    </div>`);
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
  function load(name, config, keepPage) {
    const pages = buildBookPages(name, config);
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
