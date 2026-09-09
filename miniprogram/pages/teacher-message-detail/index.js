/**
 * 寄语详情 —— 接 `GET /children/{child_id}/teacher-message`（services/assessment.js）。
 *
 * **只读，一个写入都没有**：本表无状态列、无 revision、无修改历史，契约里没有本对象的
 * `PATCH`、改写 `PUT` 或 `DELETE`（F16 第二点 / `docs/DO-NOT-BUILD.md` 第 16 条）。
 * 所以本页只有一个「返回」，没有编辑、撤回或删除。
 *
 * 无行时服务端回 404，service 把它换成 `null` —— 那不是错误，是「本学期尚未提交」，
 * 页面据此显示一句话，不弹失败提示。
 *
 * 【头像与提交时间】：`db_teacher_message` 9 列里没有头像列，`TeacherMessage` schema
 * 也没有 —— 原型那个圆形头像**没有数据源**，所以这里用姓名首字，不编一个图片出来
 * （CLAUDE.md §8）。时间列是 `created_at`，DDL 上没有 `published_at` 也没有
 * `submitted_at`，不要发明。
 */

const assess = require('../../services/assessment.js');

Page({
  data: {
    /** 从上一页带过来，取不到寄语时也能显示是谁。 */
    childName: '',
    /**
     * 头像圈里那一个字 —— 姓名的**首字**。
     *
     * 原型取的是名字的第二个字（陈小明 → 明），那要先假定姓氏只有一个字。
     * 复姓与两字名都会让那条规则取错字，而库里没有姓氏列可以问。取首字不需要
     * 任何假定，所以按首字。
     */
    avatarChar: '',
    message: null,
    /** 服务端回 404 —— 本学期尚未提交。与「加载失败」是两件事。 */
    empty: false,
  },

  onLoad(options) {
    const childId = Number(options && options.childId);
    const childName = options && options.childName ? decodeURIComponent(options.childName) : '';
    this.showName(childName);
    if (!childId) {
      this.setData({ empty: true });
      return;
    }
    this.load(childId);
  },

  showName(childName) {
    this.setData({ childName, avatarChar: childName.slice(0, 1) });
  },

  async load(childId) {
    try {
      const message = await assess.getTeacherMessage(childId);
      if (!message) {
        this.setData({ message: null, empty: true });
        return;
      }
      this.setData({ message, empty: false });
      // 姓名以回包为准：它来自名册左连接，比 URL 上带过来的那份新。
      this.showName(message.childName || this.data.childName);
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '寄语加载失败，请稍后重试', icon: 'none' });
    }
  },

  onBack() {
    wx.navigateBack();
  },
});
