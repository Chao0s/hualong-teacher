/**
 * 成长册 —— 原型 screens/growth-book.html 的小程序版本。
 *
 * 四条取数在 `services/growth-book.js` 的 `loadBookEntry()` 里合成，本页只 `setData`：
 * 编册（`POST /teacher/growth-book/compilation`）、栏目清单、全班预检、班级名册。
 *
 * ── 「栏目进度」矩阵的列是哪几个 ───────────────────────────────────────────
 *
 * F19 第三轮：行为幼儿，列只显示编册页已经勾选的栏目，单元格只表达完成／未完成，
 * 不显示页数、问题或查看列。
 *
 * **列里只有班级新增栏目。** 服务端的齐备判定按栏目的 `collected` 槽位算，
 * 在园时光与亲子时光没有槽位，所以预检对它们**没有结论**。把它们画成绿点等于
 * 替服务端下一个它没下过的结论（CLAUDE.md §8）。屏幕上有一行把这件事说出来。
 *
 * **格子有三态，不是两态。** 一个班级栏目的 `collected_slot_count` 为 0 时，
 * 预检对它同样产不出结论，那一列画的是空心灰点「无判定」——
 * 与上面那两个预设栏目同一个处置。两态只画完成／未完成的话，
 * 一个还没放征集槽的栏目会把全班每一名幼儿都画成完成。
 *
 * 页数也不显示：`total_pages` 要 composer，而 12 个版式包 0 个 released
 * （`db/GAPS.md` **G93** —— 全班预检的三个页数字段产不出来）。
 *
 * ── 「全班定稿」按下去会发生什么 ───────────────────────────────────────────
 *
 * 一名幼儿两发：`POST /books`（建册，幂等）拿 `growth_book_id`，
 * 再 `POST /books/{id}/publication` 走 b1→b2。**第二发不可逆**：服务端在同一事务里
 * 向那名幼儿当时的每一名监护人各建一笔 `n5` 通知，家长立刻在 App 里看得到，
 * 册子从此永久唯读。所以确认框把这三件事逐条写出来，再问一次。
 *
 * 前置是编册已锁定（e2）。没锁就点不动 —— 那不是界面的规矩，是服务端的：
 * `book.publish` 的前置里写着 `compilation_status=e2`。
 */

const bookApi = require('../../services/growth-book.js');

Page({
  data: {
    sumTitle: '',
    sumList: '',
    tplState: '',
    locked: false,
    gateNote: '',
    progressNote: '',
    matrixNote: '',
    overall: 0,
    colNames: [],
    gridColumns: '',
    tableWidth: 640,
    rows: [],

    sheetOpen: false,
    sheetRows: [],
    allChecked: false,
    allDisabled: true,
    busy: false,
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    let book;
    try {
      book = await bookApi.loadBookEntry();
    } catch (err) {
      this.book = null;
      this.setData({
        sumTitle: '读不到本班本学期的成长册',
        sumList: bookApi.bookFailureText(err),
        tplState: '',
        locked: false,
        gateNote: '',
        progressNote: '',
        matrixNote: '',
        overall: 0,
        colNames: [],
        rows: [],
      });
      return;
    }

    this.book = book;
    const cols = book.columns;
    this.setData({
      sumTitle: `已收录 ${book.enabledCount} 项内容`,
      sumList: book.enabledNames.length
        ? book.enabledNames.join(' · ')
        : '尚未勾选任何栏目，点击进入编辑样板',
      tplState: book.compilation.statusLabel,
      locked: book.compilation.locked,
      gateNote: book.compilation.locked
        ? ''
        : '编册还没有锁定，服务端不接受逐册定稿；请先在编辑样板里锁定编册。',
      overall: book.childCount
        ? Math.round((book.publishedCount / book.childCount) * 100) : 0,
      progressNote: `已开放 ${book.publishedCount}/${book.childCount} 本，`
        + `另有 ${book.readyCount} 名幼儿可定稿`,
      matrixNote: book.matrixNote,
      colNames: cols.map((section) => section.name),
      /* 原型：minWidth = max(320, 120 + 列数 × 82) px，1px 记 2rpx */
      gridColumns: `240rpx repeat(${cols.length}, 1fr)`,
      tableWidth: Math.max(640, 240 + cols.length * 164),
      rows: book.rows.map((row) => ({ id: row.id, name: row.name, states: row.states })),
    });
  },

  onEditTemplate() {
    wx.navigateTo({ url: '/pages/growth-book-edit/index' });
  },

  onSample() {
    wx.navigateTo({ url: '/pages/growth-book-sample/index' });
  },

  /* ---------- 全班定稿：问题幼儿置灰，教师可明确跳过 ---------- */

  onOpenFinalize() {
    if (!this.book) return;
    if (!this.data.locked) {
      wx.showToast({ title: '请先在编辑样板里锁定编册', icon: 'none' });
      return;
    }
    const sheetRows = this.book.rows.map((row) => ({
      id: row.id,
      name: row.name,
      ok: row.canPublish,
      checked: row.canPublish,
      desc: row.published ? '已定稿开放'
        : (row.issues.join('；') || '内容齐备'),
    }));
    this.setData({ sheetOpen: true, sheetRows, ...this.selectAllState(sheetRows) });
  },

  onCloseFinalize() {
    this.setData({ sheetOpen: false });
  },

  /* 「全选」只在可选的行全部勾上时才亮；一个可选的行都没有时它自己也不可点。 */
  selectAllState(rows) {
    const list = rows.filter((row) => row.ok);
    return {
      allChecked: list.length > 0 && list.every((row) => row.checked),
      allDisabled: list.length === 0,
    };
  },

  onToggleAll() {
    if (this.data.allDisabled) return;
    const allChecked = !this.data.allChecked;
    const sheetRows = this.data.sheetRows.map((row) => (row.ok ? { ...row, checked: allChecked } : row));
    this.setData({ sheetRows, ...this.selectAllState(sheetRows) });
  },

  onToggleRow(e) {
    const i = Number(e.currentTarget.dataset.index);
    if (!this.data.sheetRows[i].ok) return;
    const sheetRows = this.data.sheetRows
      .map((row, index) => (index === i ? { ...row, checked: !row.checked } : row));
    this.setData({ sheetRows, ...this.selectAllState(sheetRows) });
  },

  /**
   * 按下「定稿并开放」之后、真的发出去之前的最后一问。
   *
   * 确认框逐条写出这一发的三件不可逆的事（§7.5：不可逆动作要让教师看见它不可逆）：
   * 册子永久唯读、每名监护人各收到一条通知、跳过的幼儿留在 b1。
   */
  onConfirmFinalize() {
    if (this.data.busy) return;
    const ids = this.data.sheetRows.filter((row) => row.ok && row.checked).map((row) => row.id);
    if (!ids.length) {
      wx.showToast({ title: '请至少选择 1 名幼儿', icon: 'none' });
      return;
    }
    const skipped = this.data.sheetRows.filter((row) => !row.checked && row.desc !== '已定稿开放').length;
    wx.showModal({
      title: `定稿 ${ids.length} 本，不可撤销`,
      content: `这一步会把所选 ${ids.length} 本成长册永久锁定为只读，`
        + '并立刻给每一名监护人各发一条 App 内通知，家长马上就能看到整本册子。'
        + `定稿之后不能改、不能撤回。${skipped ? `另有 ${skipped} 名幼儿这次跳过，仍留在准备中。` : ''}`,
      confirmText: '确认定稿',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) this.finalize(ids);
      },
    });
  },

  /** 逐册各自成败，所以三个数都报出来，不说「全部成功」。 */
  async finalize(ids) {
    this.setData({ busy: true });
    wx.showLoading({ title: '正在定稿', mask: true });
    let result;
    try {
      result = await bookApi.publishClassBooks(ids);
    } catch (err) {
      wx.hideLoading();
      this.setData({ busy: false });
      wx.showToast({ title: bookApi.bookFailureText(err), icon: 'none' });
      return;
    }
    wx.hideLoading();
    this.setData({ busy: false, sheetOpen: false });
    await this.refresh();
    const failed = result.failures.length;
    wx.showModal({
      title: '定稿结果',
      content: failed
        ? `已定稿并开放 ${result.published} 本，${failed} 本没有成功：`
          + `${result.failures.map((f) => f.text).join('；')}`
        /* 通知的条数客户端读不到（这一发回的是 GrowthBook，没有计数格），
           而「零监护人合法零通知」（§4 规则 89）。所以照规则说，不说「已通知」。 */
        : `已定稿并开放 ${result.published} 本。服务端在同一事务里按每名幼儿当下的监护人`
          + '各建一条通知；没有监护人的幼儿不产生通知。',
      showCancel: false,
    });
  },
});
