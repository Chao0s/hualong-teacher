/**
 * 教研培训 —— 研修活动列表，数据来自 `GET /trainings`。
 *
 * ── 两区是服务端切的，不是本地筛的 ─────────────────────────────────────────
 *
 * 「最新研修」发 `phase=latest`（upcoming + ongoing），「历史研修」发 `phase=history`。
 * **客户端一个日期都不推** —— 阶段由服务端按**园所时区**算（DO-NOT-BUILD 9），
 * 本地按 `start_at` 比大小会用设备时区，跨日那一刻两边就不一致了。
 *
 * 两区各发一次请求。合成一次再本地分是省不了的：游标是按分区绑指纹的，
 * 混在一起翻页会撞 `cursor_filter_mismatch`。
 *
 * ── 卡片上那三样都有据可查 ─────────────────────────────────────────────────
 *
 * 徽章读派生的 `training_phase`，不是另存的类型（F9 已删 `training_type`）；
 * 摘要是服务端从正文截的 `excerpt`；「已报名」读 `my_participation_status`。
 *
 * 原型卡片脚上那两个胶囊写着「研修材料 4」「反馈 24」—— **列表端点两个都不回**，
 * 材料数与回馈数只在详情里有。硬要显示就得给每张卡各打一次详情，那是 N+1。
 * 所以列表脚上改放**有据可查的三样**：地点、主讲、本人参与状态。
 */

const training = require('../../services/training');
const guard = require('../../utils/guard');

const PROFILE_ROUTES = {
  user: '/pages/teacher-profile/index',
  book: '/pages/my-training/index',
};

const PAGE_LIMIT = 20;

Page({
  data: {
    profiles: [
      { key: 'user', title: '个人档案', desc: '教龄、学历、证书与专业发展记录' },
      { key: 'book', title: '我的研修', desc: '参与记录、提交材料与研修成果' },
    ],

    groups: [],
    loading: true,
    error: '',
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      // 两区互不依赖，没有理由排队。
      const [latest, history] = await Promise.all([
        training.listTrainings({ phase: 'latest', limit: PAGE_LIMIT }),
        training.listTrainings({ phase: 'history', limit: PAGE_LIMIT }),
      ]);
      this.setData({
        loading: false,
        groups: [
          { key: 'latest', title: '最新研修', items: latest.items.map(toCard) },
          { key: 'history', title: '历史研修', items: history.items.map(toCard) },
        ],
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        groups: [],
        error: err.userMessage || '研修列表加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
  },

  onProfileTap(e) {
    wx.navigateTo({ url: PROFILE_ROUTES[e.currentTarget.dataset.key] });
  },

  onTrainingTap(e) {
    wx.navigateTo({ url: `/pages/training-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});

/**
 * 一张卡片。**所有判断都在这里做完**，模板只读属性。
 *
 * 模板里不写 `indexOf` 之类的方法调用 —— 那个表达式在真机上算不出来，
 * 选照片那两页撞过（见 `home-school-moment-feed` 的 onTogglePhoto 头注）。
 */
function toCard(t) {
  const pills = [];
  if (t.location) pills.push(t.location);
  if (t.speaker) pills.push(`主讲：${t.speaker}`);
  if (t.myStatusLabel) pills.push(t.myStatusLabel);
  return {
    id: t.id,
    title: t.title,
    // 徽章就是派生阶段：未开始／进行中／已结束。
    badge: t.phaseLabel,
    // 时间在前，地点主讲挪到脚上的胶囊里，一行不塞三样。
    meta: t.hasEnd ? `${t.startStamp} — ${t.endStamp}` : t.startStamp,
    summary: t.excerpt,
    pills,
  };
}
