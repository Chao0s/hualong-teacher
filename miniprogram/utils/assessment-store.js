/**
 * 综合评估共享数据与草稿存储 —— 原样搬自原型 screens/assessment-store.js。
 *
 * 四个页面共用：综合评估入口、开始评估、评估结果、班级评估报告。
 * 只改了两处，其余（124 题量表、铺分算法、演示数据）一字未动：
 *   1. localStorage 换成 wx.getStorageSync / wx.setStorageSync。
 *      小程序的 Storage 直接存对象，不用自己 JSON.parse／stringify；取不到时返回空串。
 *   2. 末尾补 module.exports，原型里这些是挂在全局的。
 */

/* 综合评估共享数据与草稿存储（原型阶段用 localStorage 模拟后端草稿接口） */
const ASSESS_CHILDREN = [
  { id: 'chen', name: '陈小明' },
  { id: 'li', name: '李雨萱' },
  { id: 'zhang', name: '张力轩' },
  { id: 'wang', name: '王子涵' },
  { id: 'zhao', name: '赵佳怡' }
];

/* 量表结构：5 大领域 × 题项（id/名称），题目全文见 data/guide-scale.json */
const ASSESS_SCALE = [{"id":"H","name":"健康","items":[{"id":"H1-1-1","name":"身高体重适宜"},{"id":"H1-1-2","name":"站坐行走姿势"},{"id":"H1-2-1","name":"情绪稳定"},{"id":"H1-2-2","name":"情绪调节与安抚"},{"id":"H1-2-3","name":"分享情绪"},{"id":"H1-2-4","name":"转换情绪"},{"id":"H1-3-1","name":"适应冷热环境"},{"id":"H1-3-2","name":"身体适应环境变化"},{"id":"H1-3-3","name":"适应人际环境"},{"id":"H2-1-1","name":"平衡行走"},{"id":"H2-1-2","name":"钻爬攀登"},{"id":"H2-1-3","name":"跳跃能力"},{"id":"H2-1-4","name":"跑动与躲闪"},{"id":"H2-1-5","name":"球类操控"},{"id":"H2-2-1","name":"悬吊"},{"id":"H2-2-2","name":"投掷"},{"id":"H2-2-3","name":"单脚跳"},{"id":"H2-2-4","name":"快跑"},{"id":"H2-2-5","name":"行走耐力"},{"id":"H2-3-1","name":"画图形"},{"id":"H2-3-2","name":"使用餐具"},{"id":"H2-3-3","name":"使用剪刀"},{"id":"H2-3-4","name":"使用劳动工具"},{"id":"H3-1-1","name":"作息与午睡"},{"id":"H3-1-2","name":"参加体育活动"},{"id":"H3-1-3","name":"饮食习惯"},{"id":"H3-1-4","name":"饮水习惯"},{"id":"H3-1-5","name":"用眼卫生"},{"id":"H3-1-6","name":"刷牙与洗手"},{"id":"H3-2-1","name":"穿脱衣物"},{"id":"H3-2-2","name":"整理物品"},{"id":"H3-2-3","name":"根据冷热增减衣服"},{"id":"H3-3-1","name":"防范陌生人"},{"id":"H3-3-2","name":"遵守安全规则"},{"id":"H3-3-3","name":"运动中的安全"},{"id":"H3-3-4","name":"求助与防灾"}]},{"id":"L","name":"语言","items":[{"id":"L1-1-1","name":"专注倾听"},{"id":"L1-1-2","name":"理解语言含义"},{"id":"L1-1-3","name":"听不懂时提问"},{"id":"L1-1-4","name":"听懂普通话"},{"id":"L1-2-1","name":"表达意愿"},{"id":"L1-2-2","name":"语言与发音"},{"id":"L1-2-3","name":"表达需要与想法"},{"id":"L1-2-4","name":"讲述的连贯与生动"},{"id":"L1-3-1","name":"交谈时的回应"},{"id":"L1-3-2","name":"调节音量语气"},{"id":"L1-3-3","name":"使用礼貌用语"},{"id":"L1-3-4","name":"轮流讲话"},{"id":"L1-3-5","name":"情境化语言"},{"id":"L2-1-1","name":"主动阅读"},{"id":"L2-1-2","name":"谈论图书内容"},{"id":"L2-1-3","name":"对文字符号的兴趣"},{"id":"L2-1-4","name":"爱护图书"},{"id":"L2-2-1","name":"理解故事内容"},{"id":"L2-2-2","name":"读图与推测情节"},{"id":"L2-2-3","name":"作品的情绪体验"},{"id":"L2-2-4","name":"文字与画面的关系"},{"id":"L2-3-1","name":"用图画符号表达"},{"id":"L2-3-2","name":"书写姿势"},{"id":"L2-3-3","name":"书写自己的名字"}]},{"id":"S","name":"社会","items":[{"id":"S1-1-1","name":"与同伴交往"},{"id":"S1-1-2","name":"与长辈交往"},{"id":"S1-1-3","name":"分享快乐"},{"id":"S1-2-1","name":"加入同伴游戏"},{"id":"S1-2-2","name":"分享与合作"},{"id":"S1-2-3","name":"解决同伴冲突"},{"id":"S1-2-4","name":"接纳他人意见"},{"id":"S1-2-5","name":"不欺负他人"},{"id":"S1-3-1","name":"自主选择与发起活动"},{"id":"S1-3-2","name":"自我肯定"},{"id":"S1-3-3","name":"自己的事情自己做"},{"id":"S1-3-4","name":"承担任务与坚持"},{"id":"S1-3-5","name":"坚持自己的意见"},{"id":"S1-4-1","name":"与长辈的礼貌交往"},{"id":"S1-4-2","name":"关注他人情绪"},{"id":"S1-4-3","name":"不打扰别人"},{"id":"S1-4-4","name":"尊重劳动成果"},{"id":"S1-4-5","name":"接纳差异"},{"id":"S2-1-1","name":"参与群体活动"},{"id":"S2-1-2","name":"对园所与小学的期待"},{"id":"S2-2-1","name":"遵守规则"},{"id":"S2-2-2","name":"爱护与归还物品"},{"id":"S2-2-3","name":"诚实不说谎"},{"id":"S2-2-4","name":"完成任务"},{"id":"S2-2-5","name":"节约与爱护环境"},{"id":"S2-3-1","name":"家庭归属"},{"id":"S2-3-2","name":"集体归属"},{"id":"S2-3-3","name":"认识家乡"},{"id":"S2-3-4","name":"国家认同"},{"id":"S2-3-5","name":"民族认识"}]},{"id":"K","name":"科学","items":[{"id":"K1-1-1","name":"亲近自然与新事物"},{"id":"K1-1-2","name":"动手动脑探索"},{"id":"K1-1-3","name":"探索中的成就感"},{"id":"K1-2-1","name":"观察与比较"},{"id":"K1-2-2","name":"提出猜想并验证"},{"id":"K1-2-3","name":"调查收集信息"},{"id":"K1-2-4","name":"记录探究结果"},{"id":"K1-2-5","name":"探究中的合作交流"},{"id":"K1-3-1","name":"认识动植物"},{"id":"K1-3-2","name":"认识材料特性"},{"id":"K1-3-3","name":"认识物理现象"},{"id":"K1-3-4","name":"认识季节变化"},{"id":"K1-3-5","name":"人与自然、科技的关系"},{"id":"K2-1-1","name":"对形状的兴趣"},{"id":"K2-1-2","name":"对数的兴趣与应用"},{"id":"K2-2-1","name":"区分量的特点"},{"id":"K2-2-2","name":"比较数量多少"},{"id":"K2-2-3","name":"点数与数的关系"},{"id":"K2-2-4","name":"用数词描述与记录"},{"id":"K2-3-1","name":"感知形状特征"},{"id":"K2-3-2","name":"形体结构与造型"},{"id":"K2-3-3","name":"方位词与空间位置"},{"id":"K2-3-4","name":"辨别左右"}]},{"id":"A","name":"艺术","items":[{"id":"A1-1-1","name":"感受自然之美"},{"id":"A1-1-2","name":"感受声音之美"},{"id":"A1-2-1","name":"欣赏表演艺术"},{"id":"A1-2-2","name":"欣赏美术作品"},{"id":"A2-1-1","name":"参与音乐表演活动"},{"id":"A2-1-2","name":"参与美术创作活动"},{"id":"A2-1-3","name":"合作与独立表现"},{"id":"A2-2-1","name":"唱歌能力"},{"id":"A2-2-2","name":"身体动作表现音乐"},{"id":"A2-2-3","name":"即兴创编与表演"},{"id":"A2-2-4","name":"美术创作与运用"}]}];

const AssessStore = (() => {
  const KEY = 'hualong.comp-assessment.v1';
  const TOTAL = ASSESS_SCALE.reduce((n, d) => n + d.items.length, 0);
  let memory = null;

  function read() {
    try {
      const raw = wx.getStorageSync(KEY);
      return raw === '' || raw === undefined ? null : raw;
    } catch (e) { return memory; }
  }
  function write(all) {
    memory = all;
    try { wx.setStorageSync(KEY, all); } catch (e) {}
  }
  function statusOf(record) {
    if (!record || !record.rated) return 'miss';
    return record.rated >= TOTAL ? 'done' : 'draft';
  }
  /* 按领域目标均分铺分：n 题中取 k 题给 base+1、其余给 base，使该领域均值≈目标值。
     k 题在领域内均匀散开，避免明细里出现一整段相同分值。 */
  function profileScores(targets) {
    const scores = {};
    ASSESS_SCALE.forEach(domain => {
      const target = targets[domain.name];
      const n = domain.items.length;
      const base = Math.floor(target);
      const k = Math.round((target - base) * n);
      domain.items.forEach((item, i) => {
        const bump = Math.floor((i + 1) * k / n) > Math.floor(i * k / n) ? 1 : 0;
        scores[item.id] = Math.min(5, Math.max(1, base + bump));
      });
    });
    return scores;
  }
  function record(scores) {
    const rated = Object.keys(scores).length;
    return { scores: scores, rated: rated, total: TOTAL, status: rated === TOTAL ? 'done' : 'draft' };
  }
  /* 首次进入铺演示数据；之后一律以教师实际填写的草稿为准，不再覆盖 */
  function seedIfEmpty() {
    if (read() !== null) return;
    const full = targets => record(profileScores(targets));
    const partial = (targets, count) => {
      const all = profileScores(targets);
      const ids = ASSESS_SCALE.flatMap(d => d.items.map(i => i.id)).slice(0, count);
      const scores = {};
      ids.forEach(id => { scores[id] = all[id]; });
      return record(scores);
    };
    write({
      chen: full({ 健康: 4.6, 语言: 4.1, 社会: 4.4, 科学: 3.2, 艺术: 3.8 }),
      wang: full({ 健康: 4.2, 语言: 4.7, 社会: 3.7, 科学: 4.5, 艺术: 4.6 }),
      li: partial({ 健康: 4.0, 语言: 3.6, 社会: 4.2, 科学: 3.4, 艺术: 3.9 }, 86),
      zhao: partial({ 健康: 3.5, 语言: 4.3, 社会: 3.8, 科学: 3.6, 艺术: 4.1 }, 68)
    });
  }
  /* 领域均分：只统计已评题项，未评领域返回 null */
  function domainAverages(scores) {
    return ASSESS_SCALE.map(domain => {
      const nums = domain.items.map(item => scores[item.id]).filter(Boolean);
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    });
  }
  function childName(id) {
    const child = ASSESS_CHILDREN.find(c => c.id === id);
    return child ? child.name : '';
  }

  return { KEY, TOTAL, read, write, statusOf, seedIfEmpty, domainAverages, childName };
})();

module.exports = { ASSESS_CHILDREN, ASSESS_SCALE, AssessStore };
