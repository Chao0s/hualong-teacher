/**
 * 在园时光 —— 本周上传进度，数据来自 `GET /moments/weekly-coverage`。
 *
 * ── 两列格子是怎么从一个计数算出来的 ─────────────────────────────────────────
 *
 * 端点回的是每名幼儿本周被几条 `s3` 覆盖（distinct moment_id），不是两个布尔。
 * 契约的完成口径（§4 规则 1／Q59-c1—c3）是：**>=2 完成，0 与 1 未完成**，
 * 所以「第一次／第二次」这两列正是这个 2 的展开：
 *
 *   count 0  →  未上传、未上传
 *   count 1  →  已上传、未上传
 *   count>=2 →  已上传、已上传
 *
 * **超过 2 不截断**（Q59-c3 明写）。两列放不下第三次，所以多出来的次数写在第二格
 * 的文字里（`已上传 · 共 3 次`），而不是把它丢掉——丢掉会让「传了 5 次」和
 * 「刚好传了 2 次」在页面上一模一样。
 *
 * ── 这张表不是名册快照 ─────────────────────────────────────────────────────
 *
 * 对象集合是**查询当下**仍属本班且 active 的幼儿（Q59-n3／n4a），不保存历史名册。
 * 新转入的幼儿在入班前的周次会显示 0 次。契约要求页面标示「目前班级幼儿在所选周
 * 的记录」，**不得宣称它是当周名册快照或历史稽核报表** —— 页尾那句说明就是这一条，
 * 不要删。
 */

const co = require('../../services/co-education');
const guard = require('../../utils/guard');

Page({
  data: {
    rows: [],
    loading: true,
    error: '',
  },

  onLoad() {
    this.load();
  },

  /** 从发布页返回时进度会变，重新取一次。 */
  onShow() {
    if (!this.data.loading) this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      // 不传 week_key：服务端取园所今天所在的 ISO 周，正是「本周上传进度」。
      const coverage = await co.weeklyCoverage({});
      this.setData({ rows: coverage.map(toRow), loading: false });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        rows: [],
        error: err.userMessage || '上传进度加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
  },

  onPublish() {
    wx.navigateTo({ url: '/pages/home-school-moment-publish/index' });
  },

  onFeed() {
    wx.navigateTo({ url: '/pages/home-school-moment-feed/index' });
  },
});

/** 一名幼儿的计数 → 表格的一行两格。 */
function toRow(entry) {
  const first = entry.count >= 1;
  const second = entry.count >= 2;
  return {
    childId: entry.childId,
    name: entry.name,
    cells: [
      { state: first ? 'done' : 'miss', text: first ? '已上传' : '未上传' },
      {
        state: second ? 'done' : 'miss',
        // 超过 2 次照实显示，不截断。
        text: second
          ? (entry.count > 2 ? `已上传 · 共 ${entry.count} 次` : '已上传')
          : '未上传',
      },
    ],
  };
}
