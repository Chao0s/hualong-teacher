/**
 * 填写月度评价 —— 接真接口（F25 解 G51 之后）。
 *
 *   `GET  /home-school/month-evals?child_id=&eval_month=`   回填已有的那一笔
 *   `PUT  /home-school/month-evals`                          存草稿（NONE｜e1 → e1）
 *   `POST /home-school/month-evals/{id}/publication`         发布（e1｜e2 → e3）
 *   `GET  /moments?child_id=`                                相册（见下）
 *
 * ── 存与发是两件事 ─────────────────────────────────────────────────────────
 *
 * **草稿一直是 `e1`，`e2` 作废**（F25）。`saved_at` 不在存草稿那一步写，
 * 由发布那一步写 —— 家长端报告上那个日期取的正是它，家长该看到的是发布日，
 * 不是教师某次改稿的日子。
 *
 * **发布没有回头路**：`e3` 之后存不进草稿，服务端回 409。所以发布前弹一次确认。
 *
 * ── 月份与幼儿都从真数据来 ─────────────────────────────────────────────────
 *
 * 月份 = **本学期完整覆盖的那几个月**（盖满整月才算），与矩阵页的列同一份算法，
 * 都走 `time.wholeMonthsOfTerm()`。幼儿 = 本班在园名册。两者都不写死。
 *
 * ── 相册就是这个孩子的在园时光 ─────────────────────────────────────────────
 *
 * E7 定的口径：相册 = 该幼儿被 `db_moment_upload` 标注过的 moment 的**全部照片**，
 * 按 `week_key` 分组。**不做照片级的幼儿标注**（逐张标人一学期是几千次点击）。
 * 所以没有单独的相册端点 —— `GET /moments?child_id=` 回的正是这些。
 *
 * 换幼儿或换月份要清掉已勾选的照片：那些 file_id 属于上一个孩子。
 */

const co = require('../../services/co-education');
const guard = require('../../utils/guard');
const session = require('../../utils/session');
const time = require('../../utils/time');

Page({
  data: {
    months: [],
    monthIndex: 0,
    children: [],
    childIndex: 0,

    content: '',
    // 已选照片：{ fileId, label, url }。契约只给 file_id，标签按序号，不编文件名。
    imported: [],

    evalId: 0,
    status: '',
    statusLabel: '',
    published: false,
    readonly: false,

    loading: true,
    saving: false,
    error: '',

    albumOpen: false,
    albumTitle: '',
    albumLoading: false,
    visibleGroups: [],
    picked: [],
    confirmText: '确定',
  },

  onLoad(query) {
    // 矩阵页点圆点带过来的：child 是 child_id，month 是 YYYY-MM。
    this.entry = {
      childId: Number(query.child) || 0,
      month: query.month || '',
      view: query.view === '1',
    };
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const term = session.getCurrentTerm();
      const months = term ? time.wholeMonthsOfTerm(term.start_date, term.end_date) : [];
      const roster = await co.classRoster();

      if (!months.length) {
        this.setData({ loading: false, error: '当前没有进行中的学期，无法填写月度评价。' });
        return;
      }
      if (!roster.length) {
        this.setData({ loading: false, error: '本班没有在园幼儿。' });
        return;
      }

      const monthIndex = Math.max(0, months.indexOf(this.entry.month));
      const childIndex = Math.max(0, roster.findIndex((c) => c.childId === this.entry.childId));

      this.roster = roster;
      this.setData({
        // 月份的显示文案在 service 之外算不合适，但这里只是 `YYYY-MM` 加两个字，
        // 不是格式化时间戳 —— 逐字段读，不建 Date。
        months: months.map((m) => ({ key: m, label: `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月` })),
        monthIndex,
        children: roster.map((c) => c.name),
        childIndex,
        loading: false,
      });
      await this.loadExisting();
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({ loading: false, error: err.userMessage || '加载失败，请稍后重试' });
    }
  },

  /** 回填这一格已有的那一笔。没有就是新建。 */
  async loadExisting() {
    const month = this.data.months[this.data.monthIndex].key;
    const child = this.roster[this.data.childIndex];
    try {
      const one = await co.monthEvalRow({ month, childId: child.childId });
      if (!one) {
        // 这一格还没有记录：清空表单，等着新建。
        this.setData({
          evalId: 0, status: '', statusLabel: '', published: false, readonly: false,
          content: '', imported: [],
        });
        return;
      }
      this.setData({
        evalId: one.id,
        status: one.status,
        statusLabel: one.statusLabel,
        published: one.published,
        // 已发布的只读：契约里没有 e3 回 e1 这条边（F25），能改也存不进去。
        readonly: one.published || this.entry.view,
        content: one.text,
        imported: one.fileIds.map((fid, i) => ({ fileId: fid, label: `照片 ${i + 1}`, url: '' })),
      });
      this.fillPhotoUrls();
    } catch (err) {
      this.setData({ error: err.userMessage || '这一格取不到，请稍后重试' });
    }
  },

  fillPhotoUrls() {
    this.data.imported.forEach(async (p, i) => {
      const url = await co.photoUrl(p.fileId);
      if (!url) return;
      this.setData({ [`imported[${i}].url`]: url });
    });
  },

  onMonthChange(e) {
    // 换月要清掉照片：那些引用是上一格的。
    this.setData({ monthIndex: Number(e.detail.value), imported: [], picked: [] });
    this.loadExisting();
  },

  onChildChange(e) {
    this.setData({ childIndex: Number(e.detail.value), imported: [], picked: [] });
    this.loadExisting();
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  onRemoveImported(e) {
    const fileId = Number(e.currentTarget.dataset.fileid);
    this.setData({ imported: this.data.imported.filter((p) => p.fileId !== fileId) });
  },

  /* ── 相册 ──────────────────────────────────────────────────────────────── */

  async onOpenAlbum() {
    if (this.data.readonly) return;
    const child = this.roster[this.data.childIndex];
    this.setData({
      albumOpen: true,
      albumLoading: true,
      albumTitle: `${child.name}的在园时光`,
      visibleGroups: [],
      picked: this.data.imported.map((p) => p.fileId),
      confirmText: `确定（${this.data.imported.length}）`,
    });
    try {
      // E7：相册 = 该幼儿被标注过的 moment 的全部照片，按 week_key 分组。
      const page = await co.listMoments({ childId: child.childId, limit: 100 });
      const already = this.data.imported.map((p) => p.fileId);
      const byWeek = new Map();
      for (const m of page.items) {
        const key = m.weekKey || m.dateLabel || '其他';
        if (!byWeek.has(key)) byWeek.set(key, []);
        m.fileIds.forEach((fid, i) => {
          byWeek.get(key).push({
            fileId: fid,
            label: `${m.dateLabel} ${i + 1}`,
            url: '',
            // 已经选进来的那些要显示成选中。sel 是这一行自己的状态，模板直接读。
            sel: already.indexOf(fid) > -1,
          });
        });
      }
      const groups = [...byWeek.entries()]
        .filter(([, photos]) => photos.length)
        .map(([title, photos]) => ({ title, photos }));
      if (!this.data.albumOpen) return;
      this.setData({ albumLoading: false, visibleGroups: groups });

      groups.forEach((g, gi) => {
        g.photos.forEach(async (p, pi) => {
          const url = await co.photoUrl(p.fileId);
          if (!url || !this.data.albumOpen) return;
          this.setData({ [`visibleGroups[${gi}].photos[${pi}].url`]: url });
        });
      });
    } catch (err) {
      this.setData({ albumLoading: false, error: err.userMessage || '相册取不到' });
    }
  },

  /**
   * 切换一张照片的选中。
   *
   * **用两级下标定位，不用 fileId**：`data-gi`／`data-pi` 是我自己发的整数，
   * 不经过 dataset 的取值转换。
   *
   * **选中标记写进每一行数据（`sel`），不在模板里算** ——
   * 模板里写 `picked.indexOf(item.fileId) > -1` 在**嵌套 `wx:for`** 下取不到值：
   * 外层 `wx:for-item="group"`、内层用默认 `item`，那个表达式恒为 false，
   * 于是边框与勾选标记一起失效，而底部的计数（读的是 `picked.length`）照常在变 ——
   * 三次改样式都没修好，因为病根不在样式。
   *
   * 顺带也更合规矩：CLAUDE.md §4 说页面里不判状态，模板里更不该。
   */
  onTogglePhoto(e) {
    const gi = Number(e.currentTarget.dataset.gi);
    const pi = Number(e.currentTarget.dataset.pi);
    const groups = this.data.visibleGroups;
    if (!groups[gi] || !groups[gi].photos[pi]) return;

    const next = !groups[gi].photos[pi].sel;
    this.setData({ [`visibleGroups[${gi}].photos[${pi}].sel`]: next }, () => {
      // picked 由数据推出来，不再是另一份要同步的状态。
      const picked = [];
      this.data.visibleGroups.forEach((g) => g.photos.forEach((p) => {
        if (p.sel) picked.push(p.fileId);
      }));
      this.setData({ picked, confirmText: `确定（${picked.length}）` });
    });
  },

  onCloseAlbum() {
    this.setData({ albumOpen: false });
  },

  /** 确定：把打了 `sel` 的那些收进 imported，顺带把已经取到的地址带过去。 */
  onConfirmAlbum() {
    const chosen = [];
    this.data.visibleGroups.forEach((g) => g.photos.forEach((p) => {
      if (p.sel) chosen.push(p);
    }));
    this.setData({
      albumOpen: false,
      imported: chosen.map((p, i) => ({
        fileId: p.fileId, label: `照片 ${i + 1}`, url: p.url || '',
      })),
    });
  },

  /* ── 存与发 ────────────────────────────────────────────────────────────── */

  form() {
    return {
      childId: this.roster[this.data.childIndex].childId,
      month: this.data.months[this.data.monthIndex].key,
      text: this.data.content,
    };
  },

  async onSave() {
    if (this.data.readonly || this.data.saving) return;
    const form = this.form();
    // 预检不是校验：服务端独立再验一次。这里只是让教师在点下去之前就知道缺什么。
    const why = co.whyCannotSaveMonthEval(form);
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const saved = await co.saveMonthEvalDraft({
        ...form,
        fileIds: this.data.imported.map((p) => p.fileId),
      });
      this.setData({
        saving: false,
        evalId: saved.month_eval_id,
        status: saved.month_eval_status,
        statusLabel: co.MONTH_EVAL_STATUS[saved.month_eval_status] || '草稿',
      });
      wx.showToast({ title: '草稿已保存', icon: 'none' });
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: err.userMessage || '保存失败，请稍后重试', icon: 'none' });
    }
  },

  /**
   * 发布。**没有回头路** —— 契约里没有 `e3 → e1` 这条边，所以按下去之前弹一次确认，
   * 与结束亲子任务同一条规矩。
   */
  async onPublish() {
    if (this.data.readonly || this.data.saving) return;
    const form = this.form();
    const why = co.whyCannotSaveMonthEval(form);
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }
    const child = this.roster[this.data.childIndex];
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '发布月度评价',
        content: `发布后家长立刻能看到，且不能再修改。确定发布${child.name}的这一份吗？`,
        confirmText: '发布',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    this.setData({ saving: true });
    try {
      // 先把当前内容存下来，再发布 —— 否则发布的是上一次保存的版本。
      const saved = await co.saveMonthEvalDraft({
        ...form,
        fileIds: this.data.imported.map((p) => p.fileId),
      });
      const out = await co.publishMonthEval(saved.month_eval_id);
      this.setData({
        saving: false,
        evalId: saved.month_eval_id,
        status: out.month_eval_status,
        statusLabel: co.MONTH_EVAL_STATUS[out.month_eval_status] || '已发布',
        published: true,
        readonly: true,
      });
      wx.showToast({ title: '已发布', icon: 'none' });
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: err.userMessage || '发布失败，请稍后重试', icon: 'none' });
    }
  },
});
