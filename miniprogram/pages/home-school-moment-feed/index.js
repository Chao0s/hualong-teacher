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
 * 余下的在点「+N」角标看大图时按需取。
 *
 * ── 卡片上不显示「涉及 N/M 人」与「N 位家长已查看」 ────────────────────────
 *
 * 前者要 `child_id`，列表端点不回这一列；后者在契约与 DDL 里都没有来源。
 * **两个都不要补出来**，卡片那一行只放有据可查的：状态 + 时间戳。
 *
 * ── 「收进成长册」走契约，不走本机 ─────────────────────────────────────────
 *
 * `POST /teacher/growth-book/materials`（`services/growth-book.js` 的 `addMoment`）建一条
 * `db_growth_material`（`source_type='m1'` + `moment_id`）。本页只送 `moment_id`：
 * `compilation_id` 由本班本学期派生，标题、正文与日期是服务端从 `db_moment` 抄的副本
 * （§7.3、DO-NOT-BUILD 8）。
 *
 * 哪些已经收进来了，进页时向 `GET /teacher/growth-book/materials` 要一份
 * （`source_type=m1`），按 `momentId` 对上。**不读本机暂存** —— 换一台设备答案要一样。
 *
 * ── 选照片浮层已经删掉，因为教师选片没有落点 ───────────────────────────────
 *
 * 「这则活动的哪几张照片进册」要写 `db_file_ref(owner_object='db_growth_material')`，
 * 契约里**没有任何一条端点写得了它**（`DELETE /materials/{id}` 倒是会连带清掉那一批
 * 引用）。所以本页不再画那个浮层：画了就是假装存下去了。页顶那一句把这件事说出来。
 *
 * 已收录活动可确认移出，DELETE 使用素材登记 id，保留原活动和周进度。
 * 移出清除本次收录及主题归类；重新加入会建立新的未归类记录。锁定编册由后端拒绝修改。
 */

const co = require('../../services/co-education');
const bookApi = require('../../services/growth-book');
const guard = require('../../utils/guard');

const PAGE_LIMIT = 20;
// 每张卡片上预览几张。卡片只放得下 3 格，多取的地址看不见也会过期。
const PREVIEW_PHOTOS = 3;

/**
 * 只留已发布（`s3`）的那些。
 *
 * 草稿与已撤回**整条不进这一页**：这一页叫「全部活动」，读的人当它是「发出去的东西」。
 * 草稿家长根本看不到；已撤回是管理员下架的结果，教师既不能删也不能改。
 * 两者混在流里，教师会以为家长也看得到。
 *
 * 服务端仍然回它们（契约的范围是 `s1`／`s3`／`s5` 都可读），**筛在客户端**：
 * 「哪些该出现在这一页」是这一页的取舍，不是可见性规则。真要服务端筛，
 * 得给 `GET /moments` 的 `publish_status` 参数发一个值 —— 那会让这一页
 * 拿不到总数，将来若要显示「另有 N 条草稿」就得再改回来。
 */
function publishedOnly(items) {
  return items.filter((m) => m.published);
}

Page({
  data: {
    moments: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: '',
    bookStateReady: false,
    bookStateError: false,
  },

  onLoad() {
    // 同时保存活动 id 与素材登记 id；移出接口必须使用后者。
    this.inBook = new Set();
    this.materialByMoment = new Map();
    this.load();
  },

  onShow() {
    // 从在园时光管理页移出一条再回来，收录状态就变了，所以每次显示都重取一次。
    if (!this.data.loading && !this.bookActionBusy) this.loadBookState();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const page = await co.listMoments({ limit: PAGE_LIMIT });
      this.setData({
        moments: publishedOnly(page.items).map(toCard),
        nextCursor: page.nextCursor,
        loading: false,
      });
      this.loadBookState();
      this.fillPhotos(publishedOnly(page.items));
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
        moments: this.data.moments.concat(publishedOnly(page.items).map(toCard)),
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
      this.markCards();
      this.fillPhotos(publishedOnly(page.items));
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
        const url = await co.photoUrl(fileId, m.photoOwner);
        if (!url) return;
        const at = this.data.moments.findIndex((x) => x.id === m.id);
        if (at < 0) return;
        this.setData({ [`moments[${at}].photos[${i}].url`]: url });
      });
    });
  },

  /** 点缩略图从该图开始；+N从第4张开始。短链每次重取，保留fileId对应关系。 */
  async onPreviewPhotos(e) {
    if (this.previewing) return;
    const id = Number(e.currentTarget.dataset.id);
    const card = this.data.moments.find((m) => m.id === id);
    if (!card || !card.fileIds.length) return;
    const selectedId = e.currentTarget.dataset.fileId === undefined
      ? card.fileIds[Math.min(PREVIEW_PHOTOS, card.fileIds.length - 1)]
      : Number(e.currentTarget.dataset.fileId);
    if (!card.fileIds.includes(selectedId)) return;
    this.previewing = true;
    wx.showLoading({ title: '正在打开照片', mask: true });
    try {
      // 不复用缩略图旧地址，避免页面停留超过签名有效期后黑屏。
      const photos = await Promise.all(card.fileIds.map(async (fileId) => ({
        fileId, url: await co.photoUrl(fileId, card.photoOwner),
      })));
      const selected = photos.find((photo) => photo.fileId === selectedId);
      if (!selected || !selected.url) {
        wx.showToast({ title: '这张照片暂时打不开，请稍后重试', icon: 'none' });
        return;
      }
      const urls = photos.filter((photo) => photo.url).map((photo) => photo.url);
      wx.hideLoading();
      wx.previewImage({
        urls, current: selected.url,
        fail: () => wx.showToast({ title: '照片预览失败，请重试', icon: 'none' }),
      });
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '照片暂时打不开，请稍后重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.previewing = false;
    }
  },

  /**
   * 哪些已经收进本学期编册 —— 问服务端。
   *
   * `listMaterials('m1')` 是名册型整取、不分页（§3.5），所以这一份就是全部，
   * 不必跟着 feed 的游标翻。取不到时暂停收录操作，不能把读失败当作尚未收录。
   */
  async loadBookState() {
    const seq = (this.bookStateSeq || 0) + 1;
    this.bookStateSeq = seq;
    this.setData({ bookStateReady: false, bookStateError: false });
    try {
      const items = await bookApi.listMaterials(bookApi.SOURCE_MOMENT);
      if (seq !== this.bookStateSeq) return false;
      this.materialByMoment = new Map(items.filter((row) => row.momentId !== null).map((row) => [row.momentId, row.id]));
      this.inBook = new Set(this.materialByMoment.keys());
      this.setData({ bookStateReady: true });
      this.markCards();
      return true;
    } catch (err) {
      if (seq !== this.bookStateSeq) return false;
      this.setData({ bookStateReady: false, bookStateError: true });
      if (guard.endSessionOnAuthFailure(err)) return false;
      wx.showToast({ title: '收录状态读取失败，请点击重试', icon: 'none' });
      return false;
    }
  },

  /** 把收录状态画到卡片上。翻页新来的那几张也走这里。 */
  markCards() {
    this.setData({
      moments: this.data.moments.map((m) => ({ ...m, inBook: this.inBook.has(m.id) })),
    });
  },

  /**
   * 收进本学期编册。只送 `moment_id`，其余全是服务端派生或抄来的副本。
   *
   * 失败逐格译（`addMomentFailureText`）：编册已锁定、本班本学期还没有编册、
   * 这则活动不是 `s3`、日期不在本学期、已经收过了。**一格都不吞进「操作失败」** ——
   * 这五句每一句都指着教师做得到的下一步。
   */
  async onAddToBook(e) {
    if (this.bookActionBusy) return;
    const id = Number(e.currentTarget.dataset.id);
    const card = this.data.moments.find((m) => m.id === id);
    if (!card) return;
    if (!this.data.bookStateReady) {
      await this.loadBookState();
      return;
    }
    this.bookActionBusy = true;
    // 使操作前发出的旧读取失效，避免成功后被旧收录状态覆盖。
    this.bookStateSeq = (this.bookStateSeq || 0) + 1;
    const removing = this.inBook.has(id);
    try {
      if (removing) {
        const ok = await new Promise((resolve) => wx.showModal({
          title: '移出成长册？',
          content: `将《${card.title}》移出本学期成长册，清除它的主题归类。原活动、照片和本周上传进度保留，之后可以重新加入。`,
          confirmText: '移出', cancelText: '取消',
          success: (res) => resolve(Boolean(res.confirm)), fail: () => resolve(false),
        }));
        if (!ok) return;
        wx.showLoading({ title: '正在移出成长册', mask: true });
        await bookApi.removeMaterial(this.materialByMoment.get(id));
        this.materialByMoment.delete(id);
        this.inBook.delete(id);
      } else {
        wx.showLoading({ title: '正在收进成长册', mask: true });
        const material = await bookApi.addMoment(id);
        this.materialByMoment.set(id, material.growth_material_id);
        this.inBook.add(id);
      }
      this.markCards();
      wx.showToast({ title: removing ? '已移出成长册' : '已收进本学期成长册', icon: 'none' });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      // 重复收录、另一设备刚移出或锁定时重读真实状态，不伪造成功。
      await this.loadBookState();
      wx.showToast({ title: removing ? bookApi.actionFailureText(err) : bookApi.addMomentFailureText(err), icon: 'none' });
    } finally {
      wx.hideLoading();
      this.bookActionBusy = false;
    }
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
      // 服务端删源在园时光时连带解除入册关系（契约 v0.7），所以本页只把这一条从
      // 收录名单里去掉，不再发一次移出。
      this.inBook.delete(id);
      if (this.materialByMoment) this.materialByMoment.delete(id);

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
    // 全部 file_id 留在卡上：大图预览直接用，不必再拉一次详情。
    fileIds: m.fileIds,
    // 取地址要交上去的宿主那一对（授权参数）。service 给的，页面不拼。
    photoOwner: m.photoOwner,
    photoCount: m.fileIds.length,
    // 超出前三张的照片在大图预览中查看，卡片角标说明还有几张。
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
    // 已经收进本学期编册。由 loadBookState 取回后 markCards 填上，先给 false 占位。
    inBook: false,
  };
}
