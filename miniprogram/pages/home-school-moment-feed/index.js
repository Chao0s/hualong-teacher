/**
 * 全部活动 —— 数据来自 `GET /moments`。
 *
 * ── 照片怎么来的 ───────────────────────────────────────────────────────────
 *
 * 列表端点回 `file_id`（契约的 `Moment` 含这一列），但**只有 id，没有地址** ——
 * 响应里从来不含可直接访问的地址（G16／F21）。地址要逐张走
 * `GET /media/files/{file_id}/url`，每次重验 caretaker／当前班级／`s3`，短链
 * 约 5 分钟过期。
 *
 * 所以这一页取图分两段：列表回来先按 `file_id` 画出占位格子（数量是真的），
 * 再对**每张卡最多前 3 张**并发换地址填进去。不取满 9 张是因为卡片上本来只放
 * 得下 3 格 —— 一屏 20 条动态若每条换 9 个地址就是 180 次请求，而看得见的只有 60 张。
 * 余下的在选照片浮层里按需取。
 *
 * ── 卡片上不显示「涉及 N/M 人」与「N 位家长已查看」 ────────────────────────
 *
 * 前者要 `child_id`，列表端点不回这一列；后者在契约与 DDL 里都没有来源。
 * **两个都不要补出来**，卡片那一行只放有据可查的：状态 + 时间戳。
 *
 * ── 「加入成长册」只存在本机 ───────────────────────────────────────────────
 *
 * 契约里**没有「把一条在园时光纳入编册」的端点**。`db_growth_material`
 * （`source_type='m1'` + `moment_id`）这张表是有的，138 行数据也在，但 28 条
 * growth-book 端点里管它的一条都没有。所以这个勾选**接不上**，写
 * `wx.setStorageSync`，缺口登记为 GAPS G68。
 *
 * 补这套端点是后端仓库的工作，而且 `growth-book-time-manage` 那一页要的是同一套
 * （`GAPS.md` 已把它绑到 `db_growth_material.title`）—— 为这一个勾选
 * 先补一次、接成长册时再改一次，等于做两遍。所以留待接成长册那条线时一次设计。
 */

const co = require('../../services/co-education');
const guard = require('../../utils/guard');

// 成长册选择暂存键。接上端点后这里整块删掉，见头注。
const BOOK_STORE_KEY = 'hualong.growth-book.v1';

const PAGE_LIMIT = 20;
// 每张卡片上预览几张。卡片只放得下 3 格，多取的地址看不见也会过期。
const PREVIEW_PHOTOS = 3;

function readBook() {
  try {
    const saved = wx.getStorageSync(BOOK_STORE_KEY);
    return saved && typeof saved === 'object' ? saved : {};
  } catch (e) {
    return {};
  }
}

function writeBook(config) {
  try {
    wx.setStorageSync(BOOK_STORE_KEY, config);
  } catch (e) {
    /* 存不进去就算了，和原型一样静默 */
  }
}

Page({
  data: {
    moments: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: '',

    // 选照片浮层
    picking: false,
    pickId: null,
    pickTitle: '加入成长资料',
    pickPhotos: [],
    selected: [],
    confirmText: '加入',
  },

  onLoad() {
    this.load();
  },

  onShow() {
    if (!this.data.loading) this.syncCards();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const page = await co.listMoments({ limit: PAGE_LIMIT });
      this.setData({
        moments: page.items.map(toCard),
        nextCursor: page.nextCursor,
        loading: false,
      });
      this.syncCards();
      this.fillPhotos(page.items);
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        moments: [],
        error: err.userMessage || '活动加载失败，请稍后重试',
      });
    }
  },

  /** 游标为空是结束的唯一信号（契约 §3.1）。 */
  async onReachBottom() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const page = await co.listMoments({ cursor: this.data.nextCursor, limit: PAGE_LIMIT });
      this.setData({
        moments: this.data.moments.concat(page.items.map(toCard)),
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
      this.syncCards();
      this.fillPhotos(page.items);
    } catch (err) {
      this.setData({ loadingMore: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '加载更多失败', icon: 'none' });
    }
  },

  onRetry() {
    this.load();
  },

  /**
   * 把预览格子的地址填上。
   *
   * 逐张换地址（§8.4 每次重验），所以这里并发发一批，回来一张填一张 ——
   * 不等全部到齐，慢的那张不该拖住已经好了的。
   *
   * 用 `moment_id` 定位而不是下标：翻页时 `moments` 会变长，等地址回来时下标
   * 可能已经指向别的卡了。
   */
  fillPhotos(items) {
    items.forEach((m) => {
      m.fileIds.slice(0, PREVIEW_PHOTOS).forEach(async (fileId, i) => {
        const url = await co.photoUrl(fileId);
        if (!url) return;
        const at = this.data.moments.findIndex((x) => x.id === m.id);
        if (at < 0) return;
        this.setData({ [`moments[${at}].photos[${i}].url`]: url });
      });
    });
  },

  /** 每条动态显示当前收录了几张（读本机暂存）。 */
  syncCards() {
    const material = readBook().material || [];
    this.setData({
      moments: this.data.moments.map((m) => {
        const hit = material.find((row) => row.id === m.id);
        return { ...m, pickedCount: hit ? hit.photos.length : 0 };
      }),
    });
  },

  /**
   * 打开选照片浮层。
   *
   * `file_id` 全套已经在卡片上（列表端点就回了），所以不再拉一次详情；
   * 这里只补**预览之外那几张**的地址 —— 前 3 张 fillPhotos 已经换过了。
   */
  async onOpenPick(e) {
    const id = Number(e.currentTarget.dataset.id);
    const card = this.data.moments.find((m) => m.id === id);
    if (!card) return;

    if (!card.fileIds.length) {
      wx.showToast({ title: '这条活动没有照片', icon: 'none' });
      return;
    }

    const hit = (readBook().material || []).find((row) => row.id === id);
    const selected = hit ? hit.photos.slice() : [];
    const known = new Map(card.photos.map((p) => [p.fileId, p.url]));
    this.setData({
      picking: true,
      pickId: id,
      pickTitle: hit ? '调整收录照片' : '加入成长资料',
      // 契约只给 file_id，没有文件名，所以标签按序号，不编文件名。
      pickPhotos: card.fileIds.map((fid, i) => ({
        fileId: fid, label: `照片 ${i + 1}`, url: known.get(fid) || '',
      })),
      selected,
      confirmText: this.confirmTextFor(selected.length, !!hit),
    });

    // 剩下那些的地址后补，回来一张填一张。用 pickId 守住：教师可能已经关掉浮层
    // 又打开了另一条，那时这些回包不该往新浮层里填。
    card.fileIds.forEach(async (fid, i) => {
      if (known.get(fid)) return;
      const url = await co.photoUrl(fid);
      if (!url || this.data.pickId !== id) return;
      this.setData({ [`pickPhotos[${i}].url`]: url });
    });
  },

  confirmTextFor(count, existed) {
    if (count) return `加入（${count}）`;
    return existed ? '移出成长资料' : '加入';
  },

  onTogglePhoto(e) {
    const fileId = Number(e.currentTarget.dataset.fileid);
    const selected = this.data.selected.includes(fileId)
      ? this.data.selected.filter((x) => x !== fileId)
      : this.data.selected.concat(fileId);
    const existed = !!(readBook().material || []).find((row) => row.id === this.data.pickId);
    this.setData({ selected, confirmText: this.confirmTextFor(selected.length, existed) });
  },

  onConfirmPick() {
    const id = this.data.pickId;
    const card = this.data.moments.find((m) => m.id === id);
    const photos = this.data.selected;
    const config = readBook();

    config.material = (config.material || []).filter((row) => row.id !== id);
    if (photos.length) {
      config.material.push({ id, title: card.title, date: card.date, photos });
    }
    writeBook(config);

    this.setData({ picking: false });
    this.syncCards();
    wx.showToast({
      title: photos.length ? `已加入成长资料（${photos.length} 张照片）` : '已移出成长资料',
      icon: 'none',
    });
  },

  onClosePick() {
    this.setData({ picking: false, pickId: null });
  },

  /**
   * 删除自己发布的这条时光。
   *
   * **物理删除，不可恢复**，所以先确认。契约 v0.7：教师对自己写的内容有处置权，
   * 删除会连带解除入册通道与照片引用；周覆盖计数随之回落（那是派生的）。
   *
   * 管理员已下架的（`s5`）不给删，按钮在 `can.remove` 为假时就不渲染；即便点到了，
   * 服务端也会回 409 `admin_action_exists`，这里把它翻成一句人话。
   */
  async onDelete(e) {
    const id = Number(e.currentTarget.dataset.id);
    const card = this.data.moments.find((m) => m.id === id);
    if (!card) return;

    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '删除这条活动？',
        content: `《${card.title}》将被删除，家长立刻看不到。若已加入成长册也会一并移除。此操作不可恢复。`,
        confirmText: '删除',
        confirmColor: '#c0392b',
        cancelText: '取消',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    wx.showLoading({ title: '正在删除', mask: true });
    try {
      await co.remove(id);
      wx.hideLoading();
      // 本机那份成长册选择也要跟着清，否则会留下一条指向已删内容的记录。
      const config = readBook();
      config.material = (config.material || []).filter((row) => row.id !== id);
      writeBook(config);

      this.setData({ moments: this.data.moments.filter((m) => m.id !== id) });
      wx.showToast({ title: '已删除', icon: 'none' });
    } catch (err) {
      wx.hideLoading();
      if (guard.endSessionOnAuthFailure(err)) return;
      const rule = err.details && err.details.rule;
      const text = rule === 'admin_action_exists' ? '这条已被管理员下架，请联系管理员'
        : rule === 'author_is_caller' ? '只能删除自己发布的活动'
          : rule === 'moment_term_in_progress' ? '该学期已结束，不能再删'
            : (err.userMessage || '删除失败，请稍后重试');
      wx.showToast({ title: text, icon: 'none' });
    }
  },
});

/** 一条时光 → 一张卡。tone 是配色，原型按位置轮，与内容无关。 */
const TONES = ['', 'green', 'amber'];

function toCard(m, index) {
  return {
    id: m.id,
    tone: TONES[index % TONES.length],
    title: m.title,
    date: m.dateLabel,
    text: m.content,
    // 预览格子。数量来自真实的 file_id，地址随后由 fillPhotos 逐张填上 ——
    // 先有格子后有图，这样布局不会在图片陆续到达时跳动。
    photos: m.fileIds.slice(0, PREVIEW_PHOTOS).map((fileId) => ({ fileId, url: '' })),
    // 全部 file_id 留在卡上：选照片浮层直接用，不必再拉一次详情。
    fileIds: m.fileIds,
    photoCount: m.fileIds.length,
    // 超出预览的那些只在选照片浮层里出现，卡片上用一个角标交代还有几张。
    moreCount: Math.max(0, m.fileIds.length - PREVIEW_PHOTOS),
    /**
     * 卡片左下那一行：`YYYY-MM-DD HH:mm`，垃圾桶紧跟其后。
     *
     * 原型那句「涉及 24/28 人 · 18 位家长已查看」两半都没有数据源（见头注），
     * 标题行右上那个短时间戳也去掉了 —— 同一张卡上两个时间只会让人对照着看
     * 它们是不是一回事。
     */
    stamp: m.stamp,
    /**
     * 状态只在**不是已发布**时才显示。
     *
     * `s3` 是常态，标一句「已发布」等于在重复「一切正常」；而 `s5` 必须显示 ——
     * 那是管理员下架的结果，此时垃圾桶也不渲染，不写一句的话教师会看到一条
     * 既不能删也没说为什么的动态。
     */
    statusLabel: m.status === 's3' ? '' : m.statusLabel,
    // 管理员下架的那些不给删（Q59-m1a），按钮据此不渲染。
    canRemove: m.can.remove,
    pickedCount: 0,
  };
}
