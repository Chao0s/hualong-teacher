/**
 * 在园时光发布进度汇总 — APP-STRUCTURE.md screen id `GardenProgress`（票据 17／19）。
 *
 * 教师在这里一眼看到本班这段时间发得够不够，不必翻页拼出缺口。
 *
 * ── 这一页为什么发六个请求 ───────────────────────────────────────────────────
 *
 * 契约的 `GET /moments/weekly-coverage` **一次只回一周**（`week_key` 是单值参数）。
 * 而票据要的是「本班**这段时间**的发布情况与参考频率的差距」—— 一周看不出差距，
 * 一周只看得出这一周。所以这一页按周各读一次，六周六个请求，`Promise.all` 并发。
 *
 * 这是一处**契约缺口**：没有一个端点回得了一段时间的覆盖情况。记进交接；接真服务前
 * 后端补一个跨周端点，这里就换成一次读。**不在客户端拿列表自己聚合** —— 计数口径
 * （只计 s3、distinct moment_id、撤回退出聚合）是服务端派生的，客户端算一遍就是第二份
 * 口径，而两份口径迟早会分家。
 *
 * ── 参考频率 ────────────────────────────────────────────────────────────────
 *
 * 每周两次。这个 2 不是本页挑的阈值，是契约写死的计数口径（Q59-c3：`>=2` 完成，
 * `0`／`1` 未完成，超过 2 照实显示不截断）。所以它从 `services/co-education` 来。
 *
 * ── 只读，但格子可点 ────────────────────────────────────────────────────────
 *
 * 点一格进的是**教师自己的**发布表单，带上那名幼儿与那一周（票据 19 验收项）。这不是
 * 补录：补录是替别人填，而在园时光本来就是教师写的。返回时 `onShow` 重读，那一格的
 * 状态因此已经更新，教师不必下拉。
 */

const guard = require('../../../../utils/guard');
const coEdu = require('../../../../services/co-education');
const { reportFailure } = require('../../../../utils/present');

// 看几周。六列在 390pt 屏上放不下，所以横向滚动是这一页真的会发生的事。
const WEEK_SPAN = 6;

Page({
  data: {
    ready: false,
    loading: true,

    className: '',
    // 网格只收列定义与行数据 —— 它不知道自己在渲染哪个模块。
    columns: [],
    rows: [],
    // 汇总那一句：本班这段时间发了多少，离参考频率差多少。
    summary: '',
    gapText: '',
    target: coEdu.MOMENT_WEEKLY_TARGET,

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  /**
   * 返回 `this.load()` 的 promise。平台忽略返回值，但测试要等它读完 —— 不返回的话
   * 只能靠 sleep 猜时机，而猜出来的等待迟早会在慢一点的机器上变成偶发失败。
   */
  onLoad() {
    if (!guard.requireSession()) return null;
    this.setData({ ready: true });
    // 平台顺序是 onLoad 先于 onShow，所以紧接着的那一次 onShow 要跳过：onLoad 已经读过。
    this.skipNextShow = true;
    return this.load();
  },

  /** 从发布页返回时重读，所以点过的那一格状态已经更新，教师不必下拉。 */
  onShow() {
    if (!this.data.ready) return null;
    if (this.skipNextShow) {
      this.skipNextShow = false;
      return null;
    }
    return this.load();
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load();
  },

  async load() {
    try {
      const roster = await coEdu.classRoster();
      // 先读当前周，拿到服务端认定的周键，再由它倒推出这一段的其余各周 —— 周键由
      // 服务端派生，客户端不自己算一个（契约 Moment.week_key）。
      const current = await coEdu.momentWeeklyCoverage();
      const weekKeys = coEdu.previousWeekKeys(current.weekKey, WEEK_SPAN);
      const others = await Promise.all(
        weekKeys.slice(0, -1).map((key) => coEdu.momentWeeklyCoverage(key))
      );
      const byWeek = others.concat([current]);

      this.setData({
        loading: false,
        className: roster.className,
        ...coEdu.momentProgressMatrix(roster.children, weekKeys, byWeek),
      });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /**
   * 点一格 -> 进发布表单，带上幼儿与周期。
   *
   * 组件回的是 `{ rowKey, colKey }`，两个都是字符串 —— 网格不认识 child_id，也不该认识。
   */
  onCellTap(e) {
    const { rowKey, colKey } = e.detail;
    coEdu.openMomentPublish({ childId: rowKey, weekKey: colKey });
  },

  /** 原型顶部那一枚。不带幼儿与周次 —— 那是从格子里点进来时才有的上下文。 */
  onPublishTap() {
    coEdu.openMomentPublish({});
  },

  /** 原型 `.sec` 右侧的「全部活动」。 */
  onFeedTap() {
    wx.navigateTo({ url: '/packages/co-education/pages/moment/feed' });
  },

  onBackTap() {
    wx.navigateBack();
  },
});