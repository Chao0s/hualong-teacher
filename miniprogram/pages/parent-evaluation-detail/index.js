/**
 * 家长评价完成情况 —— 谁读了、谁交了、交了什么。
 *
 * 数据来自两条端点，经 `services/co-education.js`：
 *
 *   `GET /home-school/parent-evaluations`        看板（本页列表）
 *   `GET /home-school/parent-evaluations/{id}`   详情（点一行才取）
 *
 * 折算由服务端做（`p2 → c1 已完成`，其余未完成），页面不判状态。
 *
 * ── 显示哪一期，由上一页决定 ───────────────────────────────────────────────
 *
 * 一名幼儿一个周期一份，所以整个班一次取回来是**多期混在一起**（数据集是 9 期 × 10 人）。
 * 表格是「每个孩子一行」，混期就会出现同名多行。
 *
 * 「发布家长测评」那一页点某一期进来时带 `type` 与 `period` 两个参数，
 * **本页显示那一期**。直接进来（没有参数）时退回「最近动过的那一期」——
 * 服务端按 `updated_at DESC` 排，所以第一行所属的就是它。
 *
 * 此前不收参数，于是列表上点 6 月、进来看到的却是学期评价，两页数字对不上。
 *
 * ── 三列，不是原型的四列 ───────────────────────────────────────────────────
 *
 * 原型是：幼儿 / 已读 / 已完成 / 提交内容预览。
 *
 *   已读        **F24 之后有落点了**（`db_parent_evaluation.read_at`），照原型渲染。
 *   已完成      保留。
 *   提交内容预览 **仍然不渲染**。契约的看板行明写不回 `evaluation_text`，理由是
 *               「逐条阅读走详情端点」—— 那条理由本身是对的，一次发全班正文没道理。
 *               所以正文改成**点某一行才取一笔**，用底部弹层显示，不做成表格里的一列。
 *
 * ── 点一行看正文 ───────────────────────────────────────────────────────────
 *
 * 只有 `p2`（已提交）才有正文，服务端在其余状态一律置空 —— 家长写到一半的草稿
 * 不是交给教师的东西。没有正文时弹层照实说明，**不编一句出来**。
 */

const co = require('../../services/co-education');

Page({
  data: {
    title: '',
    rate: 0,
    metrics: [],
    rows: [],
    loading: true,
    failed: '',

    // 底部弹层：点某一行才取那一笔的正文。
    sheet: false,
    sheetLoading: false,
    detail: null,
    sheetError: '',
  },

  onLoad(query) {
    // 上一页带过来的期间。两个都在才作数 —— 只有 period 分不出月度还是学期。
    this.want = (query.type && query.period)
      ? { type: query.type, period: query.period }
      : null;
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true, failed: '' });
    try {
      // 名册型集合，一个班一学年的量级，一页取得完。
      const board = await co.listParentEvaluations({ limit: 100 });
      if (!board.rows.length) {
        this.setData({ loading: false, rows: [], metrics: [], title: '', rate: 0 });
        return;
      }

      // 指定了就显示指定的那一期；没指定就退回最近动过的一期
      // （服务端按 updated_at DESC 排，第一行所属的就是它）。
      const head = this.want && board.rows.find(
        (r) => r.type === this.want.type && r.period === this.want.period,
      ) || board.rows[0];
      const rows = board.rows.filter((r) => r.type === head.type && r.period === head.period);
      const done = rows.filter((r) => r.done).length;
      const unread = rows.filter((r) => !r.read).length;

      this.setData({
        loading: false,
        title: `${head.periodLabel} · ${head.typeLabel}`,
        rate: rows.length ? Math.round((done / rows.length) * 100) : 0,
        metrics: [
          { value: String(rows.length), label: '需提交' },
          { value: String(done), label: '已提交' },
          // 未读是教师要去催的那个数：家长没看到，催「快去写」是催错了。
          { value: String(unread), label: '未读' },
        ],
        rows: rows.map((r) => ({
          id: r.id,
          childId: r.childId,
          name: r.name,
          // 两列都由 service 算好单一显示值，页面不再判一次。
          readState: r.readTone,
          readText: r.readLabel,
          state: r.stateTone,
          text: r.stateLabel,
          // 没交的那几笔点开也没有正文，先在这里挡一次，省一次请求。
          hasText: r.done,
        })),
      });
    } catch (err) {
      this.setData({
        loading: false,
        rows: [],
        failed: err.userMessage || '家长评价加载失败，请稍后重试',
      });
    }
  },

  /** 点一行取那一笔的正文。逐条读，不在列表里发全班正文。 */
  async onRowTap(e) {
    const id = Number(e.currentTarget.dataset.id);
    this.setData({ sheet: true, sheetLoading: true, detail: null, sheetError: '' });
    try {
      const detail = await co.getParentEvaluation(id);
      // 弹层可能已经被关掉又开了另一笔，回包晚到时不该往新弹层里填。
      if (!this.data.sheet) return;
      this.setData({ sheetLoading: false, detail });
    } catch (err) {
      this.setData({
        sheetLoading: false,
        sheetError: err.userMessage || '这一笔取不到，请稍后重试',
      });
    }
  },

  onCloseSheet() {
    this.setData({ sheet: false, detail: null, sheetError: '' });
  },

  /** 弹层背景吃掉滚动，别让底下的列表跟着动。 */
  noop() {},
});
