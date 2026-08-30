/** 在园时光 —— 原型 screens/home-school-moments.html 的小程序版本。 */

Page({
  data: {
    rows: [
      { name: '陈小明', cells: [{ state: 'done', text: '已上传' }, { state: 'done', text: '已上传' }] },
      { name: '李雨萱', cells: [{ state: 'done', text: '已上传' }, { state: 'wait', text: '待确认' }] },
      { name: '张力轩', cells: [{ state: 'done', text: '已上传' }, { state: 'miss', text: '未上传' }] },
      { name: '王子涵', cells: [{ state: 'done', text: '已上传' }, { state: 'done', text: '已上传' }] },
      { name: '赵佳怡', cells: [{ state: 'wait', text: '待补图' }, { state: 'miss', text: '未上传' }] },
      { name: '刘浩然', cells: [{ state: 'done', text: '已上传' }, { state: 'done', text: '已上传' }] },
    ],
  },

  onPublish() {
    wx.navigateTo({ url: '/pages/home-school-moment-publish/index' });
  },

  onFeed() {
    wx.navigateTo({ url: '/pages/home-school-moment-feed/index' });
  },
});
