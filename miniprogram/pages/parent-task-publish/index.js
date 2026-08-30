/**
 * 发布新任务 —— 原型 screens/parent-task-publish.html 的小程序版本。
 *
 * 切类型会整套替换三个输入框的内容，并把下面那条提示收起来，照抄原型。
 * 「发布给家长」只是把按钮文字改成「已生成草稿」，1.4 秒后改回，不真的发布。
 */

const TASK_COPY = {
  daily: {
    title: '亲子观察：我的家',
    background: '孩子们正在讨论家中的物品、作息和家庭成员分工，适合请家长陪伴幼儿完成一次生活观察。',
    detail: '请家长陪同幼儿选择一个家中生活场景，拍摄 1-2 张照片，并用一句话记录孩子的发现。',
  },
  community: {
    title: '社区探访：留耕堂门前的石阶',
    background: '幼儿园附近的留耕堂保留了传统建筑门楼、石阶和灰塑装饰。孩子可以从真实社区环境中观察建筑、道路和公共空间，理解生活环境与地方文化的关系。',
    detail: '请家长带幼儿在安全距离内观察留耕堂外观，拍摄一张照片，并请孩子说一说“这个地方和我们幼儿园有什么不同”。',
  },
};

Page({
  data: {
    types: [
      { key: 'daily', title: '日常任务', desc: '家庭生活、亲子阅读、观察记录等日常经验。' },
      { key: 'community', title: '社区任务', desc: '基于社区建筑、见闻或公共空间建立任务。' },
    ],
    type: 'daily',
    form: TASK_COPY.daily,
    submitText: '发布给家长',
    noteShown: false,
  },

  onUnload() {
    clearTimeout(this.resetTimer);
  },

  onTypeTap(e) {
    const type = e.currentTarget.dataset.key;
    this.setData({ type, form: TASK_COPY[type], noteShown: false });
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value });
  },

  onSubmit() {
    this.setData({ noteShown: true, submitText: '已生成草稿' });
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.setData({ submitText: '发布给家长' }), 1400);
  },
});
