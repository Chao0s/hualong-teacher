/**
 * 办园理念与课程体系详情页 — APP-STRUCTURE.md screen id `CourseIntroDetail`.
 *
 * 从教研培训入口一次到达：入口页的「办园理念与课程体系」直接跳这里，中间没有第二层
 * 列表（票据 14 验收项）。
 *
 * 这一页读的是一条**契约里不存在**的路径。缺口登记在 services/training.js 的头注里，
 * 这里只按既定三态呈现它读回来的东西。
 *
 * Read-only. 页面上没有任何写入控件。
 */

const guard = require('../../../../utils/guard');
const training = require('../../../../services/training');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    intro: null,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    this.load();
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load();
  },

  async load() {
    try {
      const doc = await training.courseIntro();
      this.setData({ intro: doc, loading: false });
      if (doc.intro_title) {
        wx.setNavigationBarTitle({ title: doc.intro_title });
      }
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },
});
