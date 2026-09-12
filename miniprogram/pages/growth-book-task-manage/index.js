/** 亲子时光管理：本班本学期实际收录，取消只修改教师分支。 */
const book = require('../../services/growth-book');
const co = require('../../services/co-education');
const guard = require('../../utils/guard');
Page({
  data: { children: [], termId: '', loading: true, error: '', busy: false },
  onShow() { this.load(); },
  async load() {
    const seq = (this.loadSeq || 0) + 1; this.loadSeq = seq;
    this.setData({ loading: true, error: '', children: [] });
    try {
      await guard.requireSession(); const result = await book.loadTaskManage();
      if (seq !== this.loadSeq) return;
      this.setData({ ...result, loading: false,
        children: result.children.map((child) => ({ ...child, open: child.id === this.openChildId })),
      });
    } catch (err) {
      if (seq !== this.loadSeq) return;
      guard.endSessionOnAuthFailure(err);
      this.setData({ loading: false, error: err.userMessage || err.message || '亲子时光读取失败，请重试' });
    }
  },
  onRetry() { this.load(); },
  onToggleChild(e) {
    const id = Number(e.currentTarget.dataset.id);
    this.openChildId = this.openChildId === id ? null : id;
    this.setData({ children: this.data.children.map((child) => ({ ...child, open: child.id === this.openChildId })) });
  },
  async onRemoveTask(e) {
    if (this.data.busy) return;
    const child = this.data.children.find((row) => row.id === Number(e.currentTarget.dataset.child));
    const task = child && child.tasks.find((row) => row.id === Number(e.currentTarget.dataset.task));
    if (!task || !task.canRemove) return;
    this.setData({ busy: true });
    try {
      const confirmed = await new Promise((resolve) => wx.showModal({
        title: '取消教师收录？',
        content: `取消${child.name}《${task.title}》的教师收录，原投稿和照片保留。`
          + (task.parentIncluded ? '家长也已收录，因此这条仍会保留在成长册中。' : '确认后将从该幼儿的亲子时光中移出。'),
        confirmText: '确认', cancelText: '取消',
        success: (res) => resolve(Boolean(res.confirm)), fail: () => resolve(false),
      }));
      if (!confirmed) return;
      await co.setBookInclusion(task.id, { included: false, fileIds: [] });
      await this.load();
      wx.showToast({ title: task.parentIncluded ? '已取消教师收录，家长收录保留' : '已移出亲子时光', icon: 'none' });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      await this.load();
      wx.showToast({ title: co.bookInclusionFailureText(err), icon: 'none' });
    } finally { this.setData({ busy: false }); }
  },
});
