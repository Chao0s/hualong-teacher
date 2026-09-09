/**
 * 成长册 —— 契约 `growth-book` 模块里 **G68**（在园时光与社区投稿的入册通道有表有数据、
 * 零 API 面）补上的那一族：成长素材与在园时光主题，共 8 条端点。
 *
 * Boundary: 页面 `require` 本模块、把返回值直接 `setData`，
 * **不在页面里拼 URL、不在页面里译枚举、不在页面里格式化日期、不在页面里判状态机**。
 *
 *   `GET    /teacher/growth-book/materials`                        本班本学期已入册的素材
 *   `POST   /teacher/growth-book/materials`                        把一则在园时光收进本学期编册
 *   `PATCH  /teacher/growth-book/materials/topic-assignment`       批量归入主题／撤销归类
 *   `DELETE /teacher/growth-book/materials/{growth_material_id}`   移出本学期编册
 *   `GET    /teacher/growth-book/time-topics`                      本学期主题清单
 *   `POST   /teacher/growth-book/time-topics`                      新建主题
 *   `PATCH  /teacher/growth-book/time-topics/{time_topic_id}`      重命名主题
 *   `DELETE /teacher/growth-book/time-topics/{time_topic_id}`      删除主题（＝集体撤销归类）
 *
 * ── 主题在编册时归，不在发布时选 ───────────────────────────────────────────
 *
 * F19 §四（固定书脊与学期编排）定：每个在园活动必须归入且只归入一个主题，**但那是
 * 锁定前的前置，不是发布时的字段**。关系挂在 `db_growth_material`（在园时光／社区投稿
 * 进入本学期编册的活动登记）上，`db_moment` 自己没有主题列，`MomentWrite` 也不收。
 * 2026-09-09 的 **F29**（主题只属 `m1`）确认了这一条，并把「主题属不属于社区投稿」
 * 这一格一并裁掉。
 *
 * 所以发布页没有主题控件不是漏做，本模块也**不提供任何发布时选主题的入口**。
 *
 * ── `m2` 不参与主题，所以管理页只取 `m1` ───────────────────────────────────
 *
 * `db_growth_material.source_type`：`m1`＝在园时光，`m2`＝社区投稿。F29 裁定主题只属
 * `m1` —— 亲子时光在 TOC 里只有一个一级标题、其下不分主题。给 `m2` 指派主题服务端回
 * `422 topic_not_applicable_to_source`。
 *
 * `loadTimeManage()` 因此**带 `source_type=m1` 去取**，而不是取全部再在客户端筛：
 * 筛在客户端，「全选当前结果」就会把一批注定被拒的 `m2` 一起选进去。
 *
 * ── 两条 GET 都不分页，也不收 `compilation_id` ─────────────────────────────
 *
 * 名册型集合整取（§3.5）。两个理由缺一不可：管理页的「全选当前结果」按的是**整份**
 * 筛选结果，翻到一半的全选会静默漏行；主题顺序又要取「该主题全部活动的最早来源日期」，
 * 少一页就排错。
 *
 * 「本班本学期」由服务端从会话与园所今天派生，请求里**不带 `compilation_id`，也不带
 * `term_id`**。没有进行中学期时两条 GET 回空清单；六条写入里有三条会明说
 * （`addMoment`、`assignTopic`、`createTopic` 回 `409 no_active_term`）。
 *
 * 另外三条按 id 取行（`removeMaterial`、`renameTopic`、`deleteTopic`）**同样内联学期**，
 * 但不单独报告它：行落在别的学期时回 `404`，与「这一行不存在」逐字节相同（§2.3）。
 * 少了这一条谓词，上学期那份仍停在 `e1` 的编册就从本学期改得动
 * （`uk_gbc UNIQUE (class_id, term_id)` 允许每学期各有一份）。
 *
 * ── 顺序是服务端算的，客户端不重排 ─────────────────────────────────────────
 *
 * 主题顺序取该主题全部活动 `source_date` 的最小值升序，空主题排在有活动的主题之后，
 * 同日才用 `created_seq` 打破平手（F19 §十一）。**管理页、正文与 TOC 必须共用同一个
 * 顺序**，所以它只在服务端实作一次，`listTopics()` 拿到什么顺序就是什么顺序。
 * `created_seq` 不是显示顺序（DDL 列注释写明这一点，F22 由 `sort_order` 改名就是为了
 * 拦住「直接拿它排序」）。
 *
 * 两处客户端排序都用服务端给的列，不是自己发明的：
 *   未归类清单  照 `GET /materials` 回来的 `source_date DESC` 原序，不重排
 *   主题内清单  `source_date ASC`，同日才用 `display_order ASC` 打破平手
 *
 * **主题内为什么不能只按 `display_order` 排。** 服务端建行时把 `display_order` 设成
 * 本 compilation 现有最大值加一，也就是**收录顺序**；契约与 DDL 那三句「由服务端依来源
 * 时间维护」说的是另一回事。教师补收一则更早的活动，它就排在自己主题的最后。
 * 改服务端要重排既有行，而重排是 `growth_material.create` 没有登记的副作用
 * （登记表那一行 `side_effects` 是 `NONE`），所以排在客户端：主题的顺序本来就取
 * 「该主题全部活动的最早来源日期」（F19 §十一），主题内按来源时间读是同一条尺子。
 * `display_order` 留作同日的平手打破，与主题顺序用 `created_seq` 打破平手同形。
 *
 * ── 「撤销归类」与「删除」是两件事，端点也是两条 ────────────────────────────
 *
 *   撤销归类  `assignTopic([id], null)` —— 只清空 `time_topic_id`，素材**仍在本学期
 *             编册里**，回到未归类清单可重新归类。所以它是 PATCH，不是 DELETE
 *   删除素材  `removeMaterial(id)` —— `db_growth_material` 这一行真的消失，本学期入册
 *             关系解除。**源 `db_moment` 与源投稿一行不动**（F19 §七）
 *
 * 删除整个主题等同集体撤销归类：服务端同事务把该主题下全部素材的 `time_topic_id`
 * 清空，一条入册关系都不解除。所以它在业务上可恢复 —— 重建同名主题再归一次即可。
 *
 * ── 本模块读不到 `compilation_status`，锁只能从被拒的那一次学到 ──────────────
 *
 * `e2`（编册已锁定，单向）之后这一族的写入一条都不许过，服务端每条 SQL 都内联了
 * `compilation_status='e1'`。**但这一族没有任何一条读得到那一列**：契约里读编册状态的
 * 是 `POST /teacher/growth-book/compilation`（幂等的取回或建立），它在没有编册时会**建**
 * 一行，属于成长册入口页那一步（issue #27），不是管理页该顺手调的。
 *
 * 所以页面进来时不知道锁没锁，第一次写入被拒才知道。`actionFailureText()` 把
 * `compilation_locked` 译成一句话，`isCompilationLocked()` 让页面据此收起控件。
 * 这不是防御性代码，是一条今天真的存在的边界，写在这里以免下一个人以为忘了做。
 *
 * ── 留给 issue #27 的位置 ──────────────────────────────────────────────────
 *
 * 编册、栏目与成册那三族（`/compilation`、`/sections`、`/books`、`/precheck`）都属
 * 同一个契约模块，将来加进本文件是**纯增量**：各自一段路径常量、一组 `decorate*`、
 * 一组动作键，与本族没有共享状态。本模块不导出任何全局缓存，就是为了让那一步不必先
 * 拆什么东西。
 */

const api = require('../utils/request');

const MATERIALS_PATH = '/teacher/growth-book/materials';
const TOPIC_ASSIGNMENT_PATH = '/teacher/growth-book/materials/topic-assignment';
const TIME_TOPICS_PATH = '/teacher/growth-book/time-topics';

/* ── 枚举表。权威是 hualong-backend/db/01_schema.sql 的列注释 ────────────── */

/** `db_growth_material.source_type`（01_schema.sql:1744）。 */
const SOURCE_TYPE = { m1: '在园时光', m2: '社区投稿' };

/** 只有 `m1` 参与在园时光主题（F29）。 */
const SOURCE_MOMENT = 'm1';

/** `db_growth_book_time_topic.title` 的字数上限，与 DDL 的 `VARCHAR(50)` 一致。 */
const TOPIC_TITLE_MAX = 50;

/** `api/action-registry.tsv` 的 `action_key`。 */
const ACTIONS = {
  materialCreate: 'growth_material.create',
  materialAssignTopic: 'growth_material.assign_topic',
  materialDelete: 'growth_material.delete',
  topicCreate: 'time_topic.create',
  topicRename: 'time_topic.rename',
  topicDelete: 'time_topic.delete',
};

/* ── 读 ──────────────────────────────────────────────────────────────────── */

/** `2026-04-21` -> `4月21日`。裸日期，逐字段读，不建 Date（§1.2 同一条理由）。 */
function monthDayOf(localDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate || '');
  if (!m) return localDate || '';
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/**
 * 一条入册素材。每个值都可以直接 `setData`。
 *
 * `title`／`body_text`／`source_date` 是建立时从来源抄下的**副本**，来源后来改了不回写
 * 这里（F19 §四）。所以这三个值属于素材自己，不去源 `db_moment` 再取一次。
 */
function decorateMaterial(row) {
  const sourceType = row.source_type;
  return {
    id: row.growth_material_id,
    title: row.title || '（未命名）',
    body: row.body_text || '',
    sourceType,
    sourceTypeLabel: SOURCE_TYPE[sourceType] || '未知来源',
    topicId: row.time_topic_id === undefined ? null : row.time_topic_id,
    momentId: row.moment_id === undefined ? null : row.moment_id,
    date: row.source_date || '',
    dateLabel: monthDayOf(row.source_date),
    // 服务端建行时设成本 compilation 现有最大值加一，也就是收录顺序。
    // 主题内只拿它给同一天的活动打破平手，不写它。
    order: row.display_order,
  };
}

/** 一个在园时光主题。`seq` 只是平手打破用，**不是显示顺序**，页面不拿它排。 */
function decorateTopic(row) {
  return {
    id: row.time_topic_id,
    title: row.title || '（未命名）',
    seq: row.created_seq,
  };
}

/**
 * 本班本学期已入册的素材，整份。
 *
 * `sourceType` 省略时回两支都要；管理页传 `'m1'`。
 */
async function listMaterials(sourceType) {
  const items = await api.getRoster(MATERIALS_PATH, sourceType ? { source_type: sourceType } : {});
  return items.map(decorateMaterial);
}

/** 本学期主题清单，顺序由服务端派生（F19 §十一），客户端不重排。 */
async function listTopics() {
  const items = await api.getRoster(TIME_TOPICS_PATH, {});
  return items.map(decorateTopic);
}

/**
 * 「在园时光管理」整页要的那一份数据。
 *
 * 两条 GET 各取一次、在这里合成，**页面拿到就能 `setData`**：主题带着自己的素材，
 * 未归类的单独一列，三个计数一起算好。
 *
 * 计数只数 `m1`：这一页管的是在园时光那一支，社区投稿不归主题（F29）。
 */
async function loadTimeManage() {
  const [topics, materials] = await Promise.all([
    listTopics(),
    listMaterials(SOURCE_MOMENT),
  ]);

  const grouped = new Map(topics.map((topic) => [topic.id, []]));
  const ungrouped = [];
  materials.forEach((item) => {
    // 主题已被别处删掉时这一条落回未归类，与服务端删主题的语义一致。
    // 两条取数是两次请求，中间别人删掉一个主题就会出现「素材指着一个不在清单里的主题」；
    // 那时候把它丢掉，它就从三个计数与两份清单里同时消失，教师再也点不到它。
    if (item.topicId !== null && grouped.has(item.topicId)) grouped.get(item.topicId).push(item);
    else ungrouped.push(item);
  });

  return {
    topics: topics.map((topic) => {
      // 主题内按来源日期升序，同日才用 display_order 再用 id 稳定打破平手。
      // `date` 是 `YYYY-MM-DD` 裸日期，逐字比较即是时间顺序，不建 Date（§1.2）。
      const items = grouped.get(topic.id).slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
          || a.order - b.order || a.id - b.id);
      return { id: topic.id, title: topic.title, count: items.length, items };
    }),
    // 未归类照服务端的 `source_date DESC` 原序，不重排（F19 §七「按来源时间倒序」）。
    ungrouped,
    topicCount: topics.length,
    activityCount: materials.length,
    ungroupedCount: ungrouped.length,
  };
}

/* ── 写 ──────────────────────────────────────────────────────────────────── */

/**
 * 把一则在园时光收进本学期编册（建一条 `m1` 登记）。
 *
 * 请求体只有 `moment_id`：`compilation_id`／`source_type`／`title`／`body_text`／
 * `source_date`／`display_order` 全是服务端派生或从 `db_moment` 抄的副本
 * （§7.3，DO-NOT-BUILD 8）。**`time_topic_id` 刻意不在这里** —— 建立后默认未归类，
 * 归类是另一个动作（F19 §七）。
 *
 * 入口在 `home-school-moment-feed`（全部活动，家园社共育 → 在园时光 → 全部活动）
 * 那一页的「收进成长册」。
 *
 * **教师选片没有落点。** 这一条只记标题、正文与日期三个副本；「这则活动的哪几张照片
 * 进册」要写 `db_file_ref(owner_object='db_growth_material')`，而契约里没有任何一条端点
 * 写得了它（`DELETE /materials/{id}` 倒是会连带清掉那一批引用）。所以那一页不再画
 * 选照片浮层 —— 画了就是假装存下去了。
 */
function addMoment(momentId) {
  return api.post(MATERIALS_PATH, {
    action: ACTIONS.materialCreate,
    body: { moment_id: momentId },
  });
}

/**
 * 批量改归属。`topicId` 传 `null` 就是撤销归类。
 *
 * **一条端点管两个界面动作**：下方未归类清单的「归入主题」传一个非空主题 id 与一批
 * 素材；主题内单条素材的「撤销」传 `null` 与只有一个元素的名单。服务端不认第二个入口，
 * 所以这里也只有这一个函数。
 *
 * 服务端 all-or-nothing：名单里有一条不合格就整发拒绝、一行不改。
 */
function assignTopic(ids, topicId) {
  // 撤销归类要送 null 本身，不能省略 time_topic_id —— 契约把它标成 required。
  const target = topicId === undefined ? null : topicId;
  return api.patch(TOPIC_ASSIGNMENT_PATH, {
    action: ACTIONS.materialAssignTopic,
    body: { growth_material_id: ids, time_topic_id: target },
  });
}

/**
 * 把一条素材移出本学期编册。**不可恢复，且不动来源。**
 *
 * 界面上那两段确认（「删除」→「确认删除」）是客户端的事，本端点不认第二次点击。
 */
function removeMaterial(materialId) {
  return api.del(`${MATERIALS_PATH}/${materialId}`, { action: ACTIONS.materialDelete });
}

/** 新建主题。`compilation_id`／`created_by`／`created_seq` 全是服务端设值。 */
function createTopic(title) {
  return api.post(TIME_TOPICS_PATH, {
    action: ACTIONS.topicCreate,
    body: { title: String(title || '').trim() },
  });
}

/** 重命名主题。只动 `title`，`created_seq` 没有写入控件。 */
function renameTopic(topicId, title) {
  return api.patch(`${TIME_TOPICS_PATH}/${topicId}`, {
    action: ACTIONS.topicRename,
    body: { title: String(title || '').trim() },
  });
}

/**
 * 删除主题 —— 等同集体撤销归类。
 *
 * 服务端同事务把该主题下全部素材的 `time_topic_id` 清空，**入册关系一条都不解除**。
 * 因为它可恢复（重建同名主题再归一次），界面**不做二次确认**：宿主会拦截原生确认窗，
 * 而为一个可恢复的动作再造一套两段确认只会让教师多点一下。
 */
function deleteTopic(topicId) {
  return api.del(`${TIME_TOPICS_PATH}/${topicId}`, { action: ACTIONS.topicDelete });
}

/* ── 预检与错误文案 ──────────────────────────────────────────────────────── */

/**
 * 新建或重命名主题前的本地预检。**预检不是校验**：服务端独立再验一次。
 *
 * `exceptId` 是重命名时自己那一条 —— 改成原名必须成功（重发等价）。
 */
function whyCannotNameTopic(title, topics, exceptId) {
  const text = String(title || '').trim();
  if (!text) return '请输入主题名称';
  if (text.length > TOPIC_TITLE_MAX) return `主题名称最多 ${TOPIC_TITLE_MAX} 字`;
  if ((topics || []).some((t) => t.id !== exceptId && t.title === text)) return '已经有同名主题';
  return '';
}

/** 这一次拒绝是不是「编册已锁定」。页面据此收起全部写入控件。 */
function isCompilationLocked(err) {
  return Boolean(err && err.details && err.details.rule === 'compilation_locked');
}

/**
 * 把写入失败译成教师看得懂的一句。
 *
 * 服务端零行之后才分诊，`details.rule` 那一格说得出是哪一种拒绝
 * （`routes/teacher-book.mjs`），所以这里逐格译：
 *
 *   `compilation_locked`               本学期编册已 `e2`，永久唯读
 *   `no_compilation_this_term`         本班本学期还没有编册（新建主题时的 409）
 *   `topic_not_applicable_to_source`   给社区投稿指派了主题（F29）
 *   `topic_not_in_compilation`         目标主题不属本编册
 *   `topic_title_duplicated`           同一编册内已有同名主题
 *   `all_or_nothing`                   名单里有素材刚被别处改动，整发退回
 *   `moment_not_published`             源在园时光不是已发布
 *   `moment_out_of_term`               源在园时光的日期不在本学期区间内
 *   `source_already_in_compilation`    这一则已经收过了
 */
function actionFailureText(err) {
  const rule = err && err.details ? String(err.details.rule || '') : '';
  if (rule === 'compilation_locked') return '本学期编册已锁定，主题与素材不能再改';
  if (rule === 'no_compilation_this_term') return '本班本学期还没有建立编册，请先到成长册首页建立';
  if (rule === 'topic_not_applicable_to_source') return '社区投稿不归入在园时光主题';
  if (rule === 'topic_not_in_compilation') return '这个主题不属于本学期编册，请刷新后重试';
  if (rule === 'topic_title_duplicated') return '已经有同名主题';
  if (rule === 'all_or_nothing') return '有素材刚被改动，这一次一条都没有改，请刷新后重试';
  if (rule === 'moment_not_published') return '这则活动还没有发布，发布后才能收进成长册';
  if (rule === 'moment_out_of_term') return '这则活动不在本学期范围内，收不进本学期编册';
  if (rule === 'source_already_in_compilation') return '这则活动已经收进本学期编册了';
  const code = err ? err.code : '';
  if (code === 'scope_violation') return '所选素材不在本班本学期编册里，请刷新后重试';
  if (code === 'no_active_term') return '当前没有进行中的学期，暂时不能整理成长册';
  if (code === 'not_found') return '这一条已经不在了，请刷新后重试';
  return (err && err.userMessage) || '操作失败，请稍后重试';
}

/**
 * 「收进成长册」那一发失败时要说的话。
 *
 * 与 `actionFailureText()` 只差一格：本端点的 `404` **不是**「这一条已经不在了」。
 * 服务端零行之后先查编册、再查那则在园时光，两者任缺其一都回 404（不存在与不在本班
 * 逐字节相同，§2.3）。所以这里换一句教师做得到的话：先去成长册首页建编册。
 */
function addMomentFailureText(err) {
  if (err && err.code === 'not_found') {
    return '本班本学期还没有建立编册，或这则活动不在本班；请先到成长册首页建立编册';
  }
  return actionFailureText(err);
}

module.exports = {
  SOURCE_TYPE,
  SOURCE_MOMENT,
  TOPIC_TITLE_MAX,
  listMaterials,
  listTopics,
  loadTimeManage,
  addMoment,
  assignTopic,
  removeMaterial,
  createTopic,
  renameTopic,
  deleteTopic,
  whyCannotNameTopic,
  isCompilationLocked,
  actionFailureText,
  addMomentFailureText,
};
