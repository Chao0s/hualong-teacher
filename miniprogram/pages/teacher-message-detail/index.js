/** 寄语详情 —— 原型 screens/teacher-message-detail.html 的小程序版本。 */

const MESSAGES = {
  chen: {
    name: '陈小明', avatar: '明', meta: '提交于 6月20日',
    text: '小明这学期进步很大，从入园时的害羞到现在能主动举手分享，老师为你骄傲。希望你继续保持好奇心，做勇敢表达的小朋友。',
  },
  liu: {
    name: '刘浩然', avatar: '浩', meta: '提交于 6月21日',
    text: '浩然是班里的运动小健将，也越来越懂得照顾同伴。新学期里希望你在安静活动中也能沉下心来，收获更多。',
  },
};

Page({
  data: {
    message: MESSAGES.chen,
  },

  onLoad(options) {
    const key = options.child && MESSAGES[options.child] ? options.child : 'chen';
    this.setData({ message: MESSAGES[key] });
  },

  onBack() {
    wx.navigateBack();
  },
});
