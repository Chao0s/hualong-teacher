/**
 * 寄语详情 — APP-STRUCTURE.md screen id `TeacherMessageDetail`（2026-08-26 收录）。
 *
 * 原型 teacher-message-detail.html：一条已提交的寄语，只读。
 *
 * **这一页没有编辑入口，也不该有。** 寄语提交后永久只读（spec 05 与原型都这么写），
 * 一个「修改」按钮即使被服务端拒绝，也已经许诺了一件产品不做的事。
 */

const guard = require('../../../../utils/guard');
const evaluation = require('../../../../services/evaluation');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    childId: 0,
    message: null,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const childId = Number(query && query.child_id);
    if (!childId) {
      // 缺参数是调用方的错，不是一次服务故障：说清楚，不发请求。
      this.setData({
        ready: true, loading: false, errorText: '没有指定幼儿，无法打开寄语。', errorCanRetry: false,
      });
      return;
    }
    this.setData({ ready: true, childId });
    this.load();
  },

  async load() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const message = await evaluation.messageDetail(this.data.childId);
      this.setData({ message, loading: false });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.load();
  },

  onBack() {
    wx.navigateBack();
  },
});
