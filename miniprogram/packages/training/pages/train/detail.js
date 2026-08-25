/**
 * 研修详情页 — APP-STRUCTURE.md screen id `TrainDetail`.
 *
 * 研修通知（`training_content`）与研修材料都在这一页，材料点开就走取档（票据 14 验收项）。
 *
 * Read-only. §2.3: a training outside the caller's scope comes back as 404, not
 * 403 — scope is hidden rather than confirmed, so this page treats "gone" and
 * "not yours" identically and says neither. That wording comes from the error
 * registry through reportFailure; nothing here composes it.
 *
 * **本页没有报名、反馈或评论的提交入口。** 原型 training-detail.html 有三样：报名按钮、
 * 反馈输入框与公开反馈流。三样都属于票据 16 与 18，票据 14 正文点名不要顺手补上，所以
 * 这一页上一个写入控件也没有。
 */

const guard = require('../../../../utils/guard');
const training = require('../../../../services/training');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    train: null,
    trainingId: 0,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const trainingId = Number(query.training_id);
    if (!trainingId) {
      // A missing id is the caller's bug; retrying the same URL changes nothing.
      this.setData({ ready: true, loading: false, errorText: '缺少研修编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, trainingId });
    this.load(trainingId);
  },

  onRetryLoad() {
    if (!this.data.trainingId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.trainingId);
  },

  async load(trainingId) {
    try {
      const row = await training.trainingDetail(trainingId);
      this.setData({ train: row, loading: false });
      if (row.training_title) {
        wx.setNavigationBarTitle({ title: row.training_title });
      }
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /** 打开一份研修材料。反馈由服务层统一给。 */
  onOpenMaterial(e) {
    const { id, name } = e.currentTarget.dataset;
    return training.openMaterial(this.data.trainingId, { file_id: id, file_name: name });
  },

  /** 线上会议只提供复制，不内嵌外站（F9）。 */
  onCopyMeeting() {
    training.copyMeetingLink(this.data.train.meeting.url);
  },
});
