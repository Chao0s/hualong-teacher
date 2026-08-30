/**
 * 品牌建设 · 图文介绍 —— 原型 screens/party-brand-detail.html 的小程序版本。
 * 按 `?id=` 取内容，取不到回落到 steam，口径照抄原型。
 */

const BRANDS = {
  steam: {
    title: '科技启蒙：小小工程师项目', sub: '科学探究 · 园本特色',
    chips: ['科学', '项目化学习', '党建引领'],
    body: '围绕幼儿对搭建、测量和机械结构的兴趣，教师设计桥梁、滑道、风车等探究任务，让儿童在操作中形成初步工程思维。',
  },
  dragon: {
    title: '醒狮文化：岭南艺术体验', sub: '艺术表达 · 本土课程',
    chips: ['艺术', '岭南文化', '节庆活动'],
    body: '以醒狮头饰、鼓点节奏和队形变化为线索，支持幼儿通过绘画、音乐和身体动作理解本土文化。',
  },
  garden: {
    title: '自然花园：劳动教育实践', sub: '劳动教育 · 班级共建',
    chips: ['自然', '劳动', '班级共建'],
    body: '各班认领花园小地块，儿童参与播种、观察、浇灌和记录，形成持续性的自然劳动经验。',
  },
  reading: {
    title: '书香班级：亲子阅读共建', sub: '语言发展 · 家园协同',
    chips: ['语言', '阅读', '家园社共育'],
    body: '通过班级阅读角、亲子共读打卡和故事分享日，把家庭阅读资源转化为园内语言活动。',
  },
};

Page({
  data: {
    brand: BRANDS.steam,
    gallery: ['环境图', '活动图', '作品图', '记录图'],
  },

  onLoad(options) {
    const id = options.id && BRANDS[options.id] ? options.id : 'steam';
    this.setData({ brand: BRANDS[id] });
  },
});
