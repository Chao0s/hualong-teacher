/**
 * 成长册 —— 契约 `growth-book` 模块的教师端全部操作，两族：
 *
 *   1. 成长素材与在园时光主题（8 条，**G68** 补上的那一族 —— 在园时光与社区投稿的
 *      入册通道有表有数据、零 API 面）。本文件上半。
 *   2. 编册、栏目与版面、成册与定稿（15 条）。本文件下半，从「编册、栏目、成册」
 *      那一段起。
 *
 * Boundary: 页面 `require` 本模块、把返回值直接 `setData`，
 * **不在页面里拼 URL、不在页面里译枚举、不在页面里格式化日期、不在页面里判状态机**。
 *
 * ── 第一族：成长素材与在园时光主题 ─────────────────────────────────────────
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
 * 第一族自己读不到那一列：这八条端点没有一条回 `compilation_status`。所以只用这一族的
 * 页面（`growth-book-time-manage`）进来时不知道锁没锁，第一次写入被拒才知道。
 * `actionFailureText()` 把 `compilation_locked` 译成一句话，`isCompilationLocked()`
 * 让页面据此收起控件。读得到那一列的是第二族的 `ensureCompilation()`。
 */

const api = require('../utils/request');
const co = require('./co-education');

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

/** 本班、本学期亲子收录；遍历全部分页，两支选择取并集，定稿状态来自服务端。 */
async function loadTaskManage() {
  async function allPages(read) {
    const rows = []; const seen = new Set(); let cursor;
    do {
      const page = await read(cursor); rows.push(...page.items); cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('列表分页异常，请重试');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return rows;
  }
  const [compilation, check, roster, tasks, submissions] = await Promise.all([
    ensureCompilation(), precheck(), co.classRoster(),
    allPages((cursor) => co.listTasks({ cursor, limit: 100 })),
    allPages((cursor) => co.listCommunityFeed({ cursor, limit: 100 })),
  ]);
  const taskIds = new Set(tasks.filter((task) => task.termId === compilation.termId).map((task) => task.id));
  const books = new Map(check.children.map((child) => [child.childId, child]));
  const groups = new Map(roster.map((child) => [child.childId, []]));
  for (const post of submissions) {
    if (!taskIds.has(post.taskId) || !groups.has(post.childId) || (!post.included && !post.parentIncluded)) continue;
    const state = books.get(post.childId);
    const locked = !state || state.published;
    groups.get(post.childId).push({
      id: post.id, title: post.taskTitle, date: post.submittedLabel,
      teacherIncluded: post.included, parentIncluded: post.parentIncluded,
      sourceLabel: post.included ? (post.parentIncluded ? '教师、家长均已收录' : '教师已收录') : '家长已收录',
      canRemove: post.included && !locked && !post.underCheck,
      lockReason: !state ? '暂时无法确认成长册状态' : state.published ? '成长册已定稿，不能修改' : post.underCheck ? '内容检查中，暂不能修改' : '',
      removeLabel: post.parentIncluded ? '取消教师收录' : '移出',
    });
  }
  return { termId: compilation.termId,
    children: roster.map((child) => ({ id: child.childId, name: child.name, initial: child.name.slice(-1), tasks: groups.get(child.childId) })),
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

/* ══ 编册、栏目、成册：issue #27 的纯增量 ═══════════════════════════════════
 *
 * 上面那一族（G68 的成长素材与在园时光主题）一行未改。下面这一族补的是契约同一个
 * `growth-book` 模块剩下的教师端操作：
 *
 *   `POST   /teacher/growth-book/compilation`                       取回或建立本班本学期编册
 *   `PATCH  /teacher/growth-book/compilation/{compilation_id}`      改栏目勾选（仅 e1，CAS）
 *   `POST   /teacher/growth-book/compilation/{compilation_id}/lock` 锁定编册（e1→e2，单向）
 *   `GET    /teacher/growth-book/sections`                          本班本学期栏目清单
 *   `POST   /teacher/growth-book/sections`                          新增班级栏目（NONE→d1）
 *   `PATCH  /teacher/growth-book/sections/{section_id}`             改栏目（仅 d1）
 *   `DELETE /teacher/growth-book/sections/{section_id}`             删除草稿栏目（仅 d1）
 *   `PUT    /teacher/growth-book/sections/{section_id}/widgets`     整栏目保存版面（仅 d1）
 *   `POST   /teacher/growth-book/sections/{section_id}/publication` 发布栏目（d1→d2）
 *   `POST   /teacher/growth-book/sections/{section_id}/collection`  发起征集（c1→c2）
 *   `DELETE /teacher/growth-book/sections/{section_id}/collection`  撤回征集（c2→c1，删内容）
 *   `POST   /teacher/growth-book/sections/{section_id}/reminders`   提醒家长补交（建 n4）
 *   `POST   /teacher/growth-book/books`                             建册（NONE→b1）
 *   `GET    /teacher/growth-book/precheck`                          全班预检（零写入）
 *   `POST   /teacher/growth-book/books/{growth_book_id}/publication` 逐册定稿（b1→b2）
 *
 * ── 依赖链是服务端判的，界面只是照着它显示 ─────────────────────────────────
 *
 *   园所设置 d2  →  才能进班级编册（`ensureCompilation` 没过这一关回 409）
 *   编册 e1      →  才允许改勾选、改素材、改主题、增删栏目
 *   编册 e2      →  才允许逐幼儿 b1→b2
 *   栏目 d1      →  版面可改；d2 之后永久冻结，只能撤回征集，而撤回的语意是删除
 *
 * ── 「本班本学期」不进请求 ─────────────────────────────────────────────────
 *
 * `class_id`／`school_id`／`term_id` 都是 derived（§7.3，DO-NOT-BUILD 8）。
 * `ensureCompilation()` 因此没有请求体，`precheck()` 也没有查询参数。
 *
 * ── `compilation_id` 只有一个来源 ─────────────────────────────────────────
 *
 * 契约里这条路径上**没有 GET**，`POST /compilation` 就是那个「取回或建立」：
 * 已存在回 200 带既有那一行，不存在回 201。issue #29 把它改成幂等的之前，
 * 第一发就撞 `uk_gbc UNIQUE (class_id, term_id)` 回 409，客户端从此拿不到 id。
 * 所以每一页进来都调它一次，**不缓存** —— 编册状态会被同班另一位教师改掉。
 *
 * ── 锁定（e1→e2）为什么由教师按 ─────────────────────────────────────────
 *
 * F19 §五（issue #17 复核后维持）：园所设置 d1→d2 归管理端，班级编册 e1→e2 归教师。
 * 两层锁不是同一件事，系统里也没有「校长」这个角色。登记表 `compilation.lock` 的
 * `role` 是 `teacher`、`reversible` 是 `one-way`、`idempotency` 是 `required`。
 * 幂等键由 `utils/request.js` 按登记表自动补（那张表里有 `compilation.lock`）。
 *
 * ── 预检回不了页数，所以「能不能定稿」由客户端按 problems 判 ────────────────
 *
 * `ClassPrecheck.children[]` 把 `total_pages`／`section_pages`／`publishable`
 * 标成必填，但三者都要 composer 出页序，而 12 个版式包 0 个 released
 * （`db/GAPS.md` **G93** —— 全班预检的这三个字段产不出来）。服务端因此**不编**，
 * 契约那一侧已标 `x-hualong-blocked-on: G93`。
 *
 * 客户端也不编：`canPublish` 由**回得来的两样东西**判 —— `problems` 为空
 * 且 `book_status` 不是 `b2`。页数与「服务端说可以」这两句话本模块一句都不说。
 *
 * ── 齐备判定只覆盖班级栏目 ─────────────────────────────────────────────────
 *
 * 服务端的 `problems` 只按班级栏目的 `collected` 槽位算（`routes/teacher-book.mjs`
 * 那条 SQL join 的是 `db_growth_book_section`）。`enabled_sections` 里的
 * `'time'`／`'task'` 是两个字符串，没有对应的栏目行，**因此永远不产生 problem**。
 *
 * 这不是「在园时光与亲子时光都齐备了」，是**服务端没有对它们的齐备判定**。
 * 所以入口页矩阵的列只放班级栏目，两个预设栏目不画成绿点（CLAUDE.md §8：
 * 没有数据源就不要渲染它）。
 *
 * ── 名册借的是在园时光那条只读派生 ─────────────────────────────────────────
 *
 * 预检只回 `child_id`，屏幕上要的是姓名。教师端没有单独的名册端点，
 * `services/co-education.js` 的 `classRoster()` 已经解决过同一个问题（借
 * `/home-school/moments/weekly-coverage`，它按契约回的正是「查询当下仍属本班且
 * active 的幼儿」全份、带 `child_name`）。这里直接调那一个，不再借第二条。
 *
 * ── widget 的两套名字在这里换，页面里不换 ─────────────────────────────────
 *
 * 版面编辑器的模型沿用原型的 `{id, page, x, y, w, h, type, binding, content, config}`，
 * 契约是 `{page_index, grid_x, grid_y, grid_w, grid_h, widget_type, binding_key}`。
 * `toWidgetWrite()` 在本模块换一次，页面一个契约字段名都不认得。
 *
 * **两处内容在契约里没有落点，`toWidgetWrite()` 因此不发**：
 *   1. `literal` 文字的加粗／斜体／颜色。契约的 `content` 是一个 `maxLength: 500`
 *      的字符串，DDL 的 `db_book_widget.config` 列注释写死「文字: {font_size, align};
 *      图片: {fit}」。所以只发纯文字与这三个键。
 *   2. `collected` 与其他 bound 型 widget 的 `content`。DDL 的 `ck_bw_literal`
 *      写明只有 `literal` 可以带 `content`。
 */

const roster = require('./co-education');
const session = require('../utils/session');

const COMPILATION_PATH = '/teacher/growth-book/compilation';
const SECTIONS_PATH = '/teacher/growth-book/sections';
const BOOKS_PATH = '/teacher/growth-book/books';
const PRECHECK_PATH = '/teacher/growth-book/precheck';

/* ── 枚举表。权威是 hualong-backend/db/01_schema.sql 的列注释 ────────────── */

/** `db_growth_book_compilation.compilation_status`。 */
const COMPILATION_STATUS = { e1: '编册中', e2: '编册已锁定' };

/** `db_growth_book_section.section_status`。 */
const SECTION_STATUS = { d1: '草稿', d2: '已发布' };

/** `db_growth_book_section.collection_status`。 */
const COLLECTION_STATUS = { c1: '未征集', c2: '征集中' };

/** `db_growth_book.book_status`。 */
const BOOK_STATUS = { b1: '准备中', b2: '已定稿' };

/** `db_growth_book_section.anchor_type`。四类各一编码，不靠值的形状去猜（F22）。 */
const ANCHOR_TYPE = { a1: '封面', a2: '预设栏目', a3: '园所栏目', a4: '班级栏目' };

/**
 * 固定书脊里教师可以拿来当锚点的预设栏目键（`anchor_type='a2'`）。
 *
 * 新增栏目**只能落在 TOC 之后的正文之间**（DDL 的 `anchor_after` 列注释），
 * 所以封面与三张前置页不在这份清单里。
 */
const PRESET_ANCHOR_KEYS = ['time', 'task', 'term', 'comp', 'message'];

/** 那五个预设键在屏幕上叫什么。固定书脊的名字，教师改不了。 */
const PRESET_ANCHOR_NAMES = {
  time: '在园时光',
  task: '亲子时光',
  term: '教师综合评估',
  comp: '五大领域评估',
  message: '学期寄语',
};

/** `enabled_sections` 只收这两个预设键与班级 `section_id` 的字符串形式。 */
const TOGGLEABLE_PRESET_KEYS = ['time', 'task'];

/**
 * 编册页那一行「预设必须存在的章节」要说的话（issue #17 定这句话落在这一页）。
 *
 * 教师综合评估、五大领域评估与学期寄语**不进开关、不得换序**（F19）；封面与
 * 园所介绍归管理端。教师能开关的只有在园时光、亲子时光与自己新增的栏目。
 */
const FIXED_SPINE_NOTE = '预设必须存在的章节：封面 · 园所介绍 · 扉页 · 目录 · 在园时光 · '
  + '亲子时光 · 教师综合评估 · 五大领域评估 · 学期寄语 · 封底。'
  + '其中教师综合评估、五大领域评估与学期寄语固定启用，不进开关也不能换序；'
  + '封面与园所介绍归管理端。这一页只管在园时光、亲子时光与班级新增栏目。';

/** `db_growth_book_section.name` 的字数上限，与 DDL 的 `VARCHAR(50)` 一致。 */
const SECTION_NAME_MAX = 50;

/** `db_book_widget.content` 的字数上限，与 DDL 的 `VARCHAR(500)` 一致。 */
const WIDGET_CONTENT_MAX = 500;

/** `api/action-registry.tsv` 的 `action_key`。 */
const BOOK_ACTIONS = {
  compilationEnsure: 'compilation.ensure',
  compilationUpdate: 'compilation.update',
  compilationLock: 'compilation.lock',
  sectionCreate: 'book_section.create',
  sectionUpdate: 'book_section.update',
  sectionDelete: 'book_section.delete',
  widgetSave: 'book_widget.save',
  sectionPublish: 'book_section.publish',
  collectionStart: 'collection.start',
  collectionWithdraw: 'collection.withdraw',
  sectionRemind: 'section.remind',
  bookEnsure: 'book.ensure',
  bookPublish: 'book.publish',
};

/* ── 读：解码 ────────────────────────────────────────────────────────────── */

/** 本班本学期的编册。`locked` 是这一族每一页的总闸门。 */
function decorateCompilation(row) {
  const status = row.compilation_status;
  const enabled = Array.isArray(row.enabled_sections) ? row.enabled_sections.map(String) : [];
  return {
    id: row.compilation_id,
    classId: row.class_id,
    termId: row.term_id,
    enabled,
    status,
    statusLabel: COMPILATION_STATUS[status] || '未知状态',
    locked: status === 'e2',
    revision: row.revision,
    lockedAt: row.locked_at || '',
  };
}

/**
 * 一个班级新增栏目。`published` 之后版面永久冻结（W16）。
 *
 * `collectedSlots` 是这个栏目的 `collected` 槽位数（契约的 `collected_slot_count`）。
 * **它决定这个栏目有没有齐备判定**：服务端的预检只在槽位数大于 0 时才产出
 * `collected_incomplete`，零槽位的栏目一条 problem 都不产生 —— 那是「没有结论」，
 * 不是「全班都交齐了」。读不到这一格时按 `null` 处理，页面照实说不判定，
 * **不把缺一格当成 0，也不当成有判定**。
 */
function decorateSection(row) {
  const status = row.section_status;
  const collection = row.collection_status;
  const slots = row.collected_slot_count;
  return {
    id: row.section_id,
    key: String(row.section_id),
    name: row.name || '（未命名）',
    anchorAfter: row.anchor_after === undefined || row.anchor_after === null ? '' : String(row.anchor_after),
    anchorType: row.anchor_type || '',
    anchorTypeLabel: ANCHOR_TYPE[row.anchor_type] || '',
    status,
    statusLabel: SECTION_STATUS[status] || '未知状态',
    published: status === 'd2',
    collectionStatus: collection,
    collectionLabel: COLLECTION_STATUS[collection] || '未知状态',
    collecting: collection === 'c2',
    publishedAt: row.published_at || '',
    collectedSlots: typeof slots === 'number' ? slots : null,
    judged: typeof slots === 'number' && slots > 0,
  };
}

/** 一名幼儿的一本册子。 */
function decorateBook(row) {
  const status = row.book_status;
  return {
    id: row.growth_book_id,
    childId: row.child_id,
    status,
    statusLabel: BOOK_STATUS[status] || '未知状态',
    published: status === 'b2',
    publishedAt: row.published_at || '',
  };
}

/**
 * 预检里的一名幼儿。
 *
 * `book_status` 为 `null` 是一个事实，不是缺口：本学期还没有 `db_growth_book`
 * 那一行的幼儿没有状态可给，服务端不编一个 `b1` 出来（契约原话）。
 *
 * `canPublish` 由 `problems` 与 `book_status` 两样算出来，**不读 `publishable`**
 * —— 那一格 G93 产不出来（0/12 版式包 released）。
 */
function decoratePrecheckChild(row) {
  const status = row.book_status === undefined ? null : row.book_status;
  const problems = Array.isArray(row.problems) ? row.problems : [];
  return {
    childId: row.child_id,
    bookStatus: status,
    bookStatusLabel: status ? BOOK_STATUS[status] : '未建册',
    published: status === 'b2',
    problems: problems.map((p) => ({
      rule: String(p.rule || ''),
      sectionKey: p.section_key === undefined || p.section_key === null ? '' : String(p.section_key),
    })),
    canPublish: problems.length === 0 && status !== 'b2',
  };
}

/**
 * 学期在屏幕上叫什么。
 *
 * `term_id` 是系统生成的 id（`db_school_term.term_id` 的列注释：「如
 * 2026-2027-1」），不是给教师看的名字；名字在同一张表的 `term_name` 上。
 * 契约把两者一起放在会话上下文里（`GET /auth/session` 的 `current_term`，
 * `required: [term_id, term_name, start_date, end_date]`），所以这里取那一份。
 *
 * 只有会话那一份说的就是这个学期时才用它的名字。会话给不出名字时回 `term_id`
 * —— 编一个名字出来比显示 id 更糟。
 */
function termLabel(termId) {
  const id = String(termId || '');
  const term = session.getCurrentTerm();
  if (term && term.term_id === id && term.term_name) return term.term_name;
  return id;
}

/** 一条 problem 译成教师看得懂的一句。`names` 是 `section_key` → 栏目名。 */
function problemText(problem, names) {
  const map = names || {};
  const where = problem.sectionKey ? (map[problem.sectionKey] || `栏目 ${problem.sectionKey}`) : '';
  if (problem.rule === 'collected_incomplete') return `${where}素材未交齐`;
  if (problem.rule === 'page_count_over_limit') return '页数超过 200 页';
  if (problem.rule === 'section_incomplete') return `${where}内容未齐备`;
  if (problem.rule === 'term_message_missing') return '本学期寄语未填写';
  return where ? `${where}：${problem.rule}` : problem.rule;
}

/* ── 读：取数 ────────────────────────────────────────────────────────────── */

/**
 * 取回或建立本班本学期的编册。**每一页进来调一次，不缓存。**
 *
 * 已存在回 200 带既有那一行，不存在回 201（契约声明了两个成功码）。
 * `utils/request.js` 成功时只回响应体，两个码在客户端这一侧没有分别 ——
 * 要的东西一样：`compilation_id`、`revision`、`enabled_sections` 与状态。
 */
async function ensureCompilation() {
  const row = await api.post(COMPILATION_PATH, { action: BOOK_ACTIONS.compilationEnsure, body: {} });
  return decorateCompilation(row || {});
}

/** 本班本学期的栏目清单，整份不分页（§3.5，`section_id ASC`）。 */
async function listSections() {
  const items = await api.getRoster(SECTIONS_PATH, {});
  return items.map(decorateSection);
}

/** 全班预检。零写入，带指纹；指纹逐册定稿时要原样带回去（§5.2）。 */
async function precheck() {
  const data = await api.get(PRECHECK_PATH);
  return {
    fingerprint: (data && data.content_fingerprint) || '',
    children: ((data && data.children) || []).map(decoratePrecheckChild),
  };
}

/* ── 写：编册 ────────────────────────────────────────────────────────────── */

/**
 * 改栏目勾选。`revision` 是 §5.1 三处 CAS 之一，陈旧回 409 `revision_stale`。
 *
 * `enabledSections` 只放 `'time'`、`'task'` 与班级 `section_id` 的字符串形式；
 * term、comp、message 固定启用、不进开关（F19）。
 */
async function updateCompilation(compilationId, revision, enabledSections) {
  const row = await api.patch(`${COMPILATION_PATH}/${compilationId}`, {
    action: BOOK_ACTIONS.compilationUpdate,
    body: { revision, enabled_sections: (enabledSections || []).map(String) },
  });
  return decorateCompilation(row || {});
}

/**
 * 锁定编册（e1→e2）。**单向，且是逐幼儿 b1→b2 的前置。**
 *
 * 服务端在这一发里完整重验（§4 规则 96）：已勾选 time 时全部 `m1` 在园活动须且只须
 * 归属一个主题、全部已勾选栏目的状态与齐备、本学期寄语、逐册页数不超过 200。
 * 任一项没过回 `422 validation_failed`，`details.rule` 指出是哪一项。
 *
 * 幂等键由 `utils/request.js` 自动补（登记表 `compilation.lock` 的 `idempotency`
 * 是 `required`）。
 */
async function lockCompilation(compilationId, revision) {
  const row = await api.post(`${COMPILATION_PATH}/${compilationId}/lock`, {
    action: BOOK_ACTIONS.compilationLock,
    body: { revision },
  });
  return decorateCompilation(row || {});
}

/* ── 写：栏目与版面 ──────────────────────────────────────────────────────── */

/** 新增班级栏目（NONE→d1）。`compilation_id`／`created_by` 是服务端派生。 */
async function createSection({ name, anchorAfter, anchorType }) {
  const row = await api.post(SECTIONS_PATH, {
    action: BOOK_ACTIONS.sectionCreate,
    body: {
      name: String(name || '').trim(),
      anchor_after: String(anchorAfter || 'time'),
      anchor_type: anchorType || 'a2',
    },
  });
  return decorateSection(row || {});
}

/** 改栏目（仅 d1）。契约的 `BookSectionWrite` 三个字段都是必填，整份送。 */
async function updateSection(sectionId, { name, anchorAfter, anchorType }) {
  const row = await api.patch(`${SECTIONS_PATH}/${sectionId}`, {
    action: BOOK_ACTIONS.sectionUpdate,
    body: {
      name: String(name || '').trim(),
      anchor_after: String(anchorAfter || 'time'),
      anchor_type: anchorType || 'a2',
    },
  });
  return decorateSection(row || {});
}

/** 删除草稿栏目（仅 d1）。d2 之后不可删除 —— 版面已冻结，且可能已有家庭提交（W16）。 */
function deleteSection(sectionId) {
  return api.del(`${SECTIONS_PATH}/${sectionId}`, { action: BOOK_ACTIONS.sectionDelete });
}

/** run 阵列或字符串 → 纯文字。粗斜色三个属性在契约里没有落点，这里丢掉。 */
function widgetPlainText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : []).map((run) => (run && run.t) || '').join('');
}

/**
 * 把编辑器里的一个 widget 换成契约的 `BookWidgetWrite`。
 *
 * `config` 逐键照 DDL 的 `db_book_widget.config` 列注释：文字 `{font_size, align}`，
 * 图片 `{fit}`。literal富文本样式存为正文的UTF-16区间，正文仍只存content。
 */
function toWidgetWrite(widget) {
  const isText = widget.type === 'text';
  const config = { ...(widget._wireConfig || {}), ...(isText
    ? {
      font_size: (widget.config && widget.config.size) || 14,
      align: (widget.config && widget.config.align) || 'left',
    }
    : { fit: (widget.config && widget.config.fit) || 'cover' }) };
  delete config.text_styles;
  if (isText && widget.binding === 'literal' && Array.isArray(widget.content)) {
    let offset = 0;
    const styles = [];
    widget.content.forEach((run) => {
      const start = offset; offset += String(run.t || '').length;
      if (offset > start && (run.b || run.i || run.c)) {
        const style = { start, end: offset };
        if (run.b) style.b = true;
        if (run.i) style.i = true;
        if (run.c) style.c = run.c;
        styles.push(style);
      }
    });
    if (styles.length) config.text_styles = styles;
  }
  return {
    page_index: widget.page || 0,
    grid_x: widget.x,
    grid_y: widget.y,
    grid_w: widget.w,
    grid_h: widget.h,
    widget_type: isText ? 'text' : 'image',
    binding_key: widget.binding,
    // `ck_bw_literal`：只有 literal 可以带 content，别的一律 null。
    content: widget.binding === 'literal' ? widgetPlainText(widget.content) : null,
    config,
  };
}

/**
 * 整栏目保存版面（仅 d1）。**整个栏目一次提交、一次校验、一次存档。**
 *
 * 服务端会自己重跑一次重叠检测并**拒绝整个栏目的存档**（W6）——
 * 前端的标红与置灰只是体验，不是完整性边界。回的是这一发存下了几个组件。
 */
async function saveWidgets(sectionId, widgets, pageCount) {
  const body = { widgets: (widgets || []).map(toWidgetWrite) };
  if (pageCount !== undefined) body.page_count = pageCount;
  const data = await api.put(`${SECTIONS_PATH}/${sectionId}/widgets`, {
    action: BOOK_ACTIONS.widgetSave,
    body,
  });
  return ((data && (data.widgets || data.items)) || []).length;
}

/** 完整版面回读。读失败不使用默认组件代替，保留未知配置以避免再次保存时丢失。 */
async function getWidgets(sectionId) {
  const data = await api.get(`${SECTIONS_PATH}/${sectionId}/widgets`);
  if (!data || !Array.isArray(data.widgets) || !Number.isInteger(data.page_count) || data.page_count < 1 || data.page_count > 200
    || !['d1', 'd2'].includes(data.section_status) || !['e1', 'e2'].includes(data.compilation_status)) {
    throw new Error('已存版面数据不完整，请重试');
  }
  const widgets = data.widgets.map((row) => {
    const config = row.config || {};
    const text = row.content || '';
    let content = text;
    if (row.binding_key === 'literal' && Array.isArray(config.text_styles) && config.text_styles.length) {
      content = []; let offset = 0;
      config.text_styles.forEach((style) => {
        if (style.start > offset) content.push({ t: text.slice(offset, style.start) });
        const run = { t: text.slice(style.start, style.end) };
        if (style.b) run.b = 1;
        if (style.i) run.i = 1;
        if (style.c) run.c = style.c;
        content.push(run); offset = style.end;
      });
      if (offset < text.length) content.push({ t: text.slice(offset) });
    }
    return { id: `saved-${row.widget_id}`, page: row.page_index, x: row.grid_x, y: row.grid_y,
      w: row.grid_w, h: row.grid_h, type: row.widget_type, binding: row.binding_key, content,
      config: { ...config, size: config.font_size || 14 }, _wireConfig: config };
  });
  return { widgets, pageCount: data.page_count,
    published: data.section_status === 'd2', locked: data.section_status === 'd2' || data.compilation_status === 'e2' };
}

/**
 * 发布栏目并开始征集 —— 界面上那一颗「发布征集」是**两条端点**。
 *
 * `book_section.publish` 走 d1→d2（版面永久冻结），`collection.start` 走 c1→c2
 * （只有 c2 才向家长开放）。登记表把它们分成两个动作，因为 `collection_status`
 * 不能从 `section_status` 派生（DDL 列注释：必须明确保存）。
 *
 * 两发之间断掉时栏目停在 d2／c1：版面已冻结、家长还看不到。这是一个真实存在的
 * 中间态，不是漏做 —— 页面重进后 `collecting` 为 false，可以再点一次。
 */
async function publishSection(sectionId) {
  await api.post(`${SECTIONS_PATH}/${sectionId}/publication`, {
    action: BOOK_ACTIONS.sectionPublish,
    body: {},
  });
  const row = await api.post(`${SECTIONS_PATH}/${sectionId}/collection`, {
    action: BOOK_ACTIONS.collectionStart,
    body: {},
  });
  return decorateSection(row || {});
}

/**
 * 撤回征集（c2→c1）。**状态可逆，内容不可逆。**
 *
 * 同一事务内删除本轮全部内容：已收的家庭草稿与终局提交、进行中的内容检查列、
 * 裁切成品的 `db_file_ref`，以及对象存储上的孤儿文件（W16）。重新发布时家长要重交。
 * 任一相关幼儿已 b2 时永久禁止撤回。
 */
function withdrawCollection(sectionId) {
  return api.del(`${SECTIONS_PATH}/${sectionId}/collection`, {
    action: BOOK_ACTIONS.collectionWithdraw,
  });
}

/**
 * 提醒家长补交（建 `n4`）。幂等键由 `utils/request.js` 自动补。
 *
 * 规则 99：只可对本班 d2 栏目中**尚未交齐**的幼儿发起提醒；按动作当下
 * `db_child.caretakers` 向每名当前监护人建一笔。零 caretaker 合法零通知。
 * **不得借本端点写 `db_book_material_submission`** —— F19 之后教师不得代传。
 *
 * 幂等键管的是「同一次点击被送了两次」，不是「不准再提醒一次」：教师再次明确点击
 * 会产生新一轮通知。
 *
 * 条数取契约声明的 `notification_count` 与 `notified_child_count`。取不到就回
 * `null`，调用方照实说「服务端未回条数」，**不编一个数出来**。
 */
async function remindSection(sectionId, childIds) {
  const data = await api.post(`${SECTIONS_PATH}/${sectionId}/reminders`, {
    action: BOOK_ACTIONS.sectionRemind,
    body: { child_ids: (childIds || []).map(Number) },
  });
  const children = data && data.notified_child_count;
  const count = data && data.notification_count;
  return {
    childCount: typeof children === 'number' ? children : null,
    notificationCount: typeof count === 'number' ? count : null,
  };
}

/* ── 写：成册与定稿 ──────────────────────────────────────────────────────── */

/**
 * 建册（NONE→b1）。幂等：已有回 200，新建回 201，两种都回同一份 `GrowthBook`。
 *
 * **定稿要 `growth_book_id`，而它只有这一条端点给得出来** —— 预检的
 * `children[]` 里没有这一格（契约明写，红线 4 最小必要），这条路径上也没有 GET。
 * 所以定稿永远是「先 ensure 拿 id，再 publish」两发。
 *
 * 建册时绑定三项永不回写的引用：`pack_code`、`layout_seed`、`book_release_id`。
 */
async function ensureBook(childId) {
  const row = await api.post(BOOKS_PATH, {
    action: BOOK_ACTIONS.bookEnsure,
    body: { child_id: Number(childId) },
  });
  return decorateBook(row || {});
}

/**
 * 逐册定稿（b1→b2，永久唯读）。幂等键由 `utils/request.js` 自动补。
 *
 * **这一发有不可逆的外部效果**：成功时服务端在同一事务里向**当时**每名有效
 * caretaker 各建立一笔 `n5` 通知（§4 规则 89），家长立刻在 App 里看得到。
 * 重放不重复通知；`fingerprint` 与预检不符回 409 且**零写入**。
 *
 * b2 之后永久唯读，逐册选择冻结。不生成任何文件、不签发下载链接（F17，
 * `docs/DO-NOT-BUILD.md` 第 3 条）。
 */
async function publishBook(growthBookId, fingerprint) {
  const row = await api.post(`${BOOKS_PATH}/${growthBookId}/publication`, {
    action: BOOK_ACTIONS.bookPublish,
    body: { content_fingerprint: String(fingerprint || '') },
  });
  return decorateBook(row || {});
}

/* ── 组合：整页要的那一份数据 ────────────────────────────────────────────── */

/**
 * 「成长册」入口页要的那一份（`growth-book`，家园社共育 → 成长档案 → 成长册）。
 *
 * 四条取数：编册、栏目清单、全班预检、班级名册。
 *
 * **「栏目进度」矩阵的列只放已勾选的班级栏目。** 在园时光与亲子时光不是列，
 * 因为服务端对它们**没有齐备判定**：`problems` 只按班级栏目的 `collected` 槽位算。
 * 把它们画成绿点等于替服务端下一个它没下过的结论。
 *
 * **零征集槽的班级栏目是同一件事，所以它的格子回 `'none'`。** 服务端的预检只在
 * `required_slots > 0 且 filled < required` 时产出一条 `collected_incomplete`，
 * 一个还没放征集槽的栏目因此一条 problem 都不产生。把「没有 problem」读成「完成」，
 * 那一列会把全班每一名幼儿都画成绿点 —— 与上面那两个预设栏目一模一样的错。
 * 槽位数取契约的 `collected_slot_count`；读不到那一格时也回 `'none'`，不猜。
 */
async function loadBookEntry() {
  const compilation = await ensureCompilation();
  const [sections, pre, children] = await Promise.all([
    listSections(),
    precheck(),
    roster.classRoster(),
  ]);

  const enabled = new Set(compilation.enabled);
  const columns = sections.filter((section) => enabled.has(section.key));
  const names = {};
  columns.forEach((section) => { names[section.key] = section.name; });

  const byChild = new Map(pre.children.map((child) => [child.childId, child]));
  const rows = children.map((child) => {
    const row = byChild.get(child.childId);
    const missing = new Set((row ? row.problems : []).map((p) => p.sectionKey));
    return {
      id: child.childId,
      name: child.name,
      // 三态，逐格分开：
      //   'none'  这个栏目没有征集槽，服务端对它没有齐备判定 —— 无判定
      //   'done'  有判定，且这名幼儿这一栏没有 problem
      //   'miss'  有判定，且这名幼儿这一栏未交齐；预检没有这名幼儿时也算这一档（不猜）
      states: columns.map((section) => {
        if (!section.judged) return 'none';
        return row && !missing.has(section.key) ? 'done' : 'miss';
      }),
      bookStatus: row ? row.bookStatus : null,
      bookStatusLabel: row ? row.bookStatusLabel : '未建册',
      published: !!(row && row.published),
      canPublish: !!(row && row.canPublish),
      issues: (row ? row.problems : []).map((p) => problemText(p, names)),
    };
  });

  const presetOn = TOGGLEABLE_PRESET_KEYS.filter((key) => enabled.has(key));
  const unjudged = columns.filter((section) => !section.judged);
  return {
    compilation,
    columns: columns.map((section) => ({
      key: section.key, name: section.name, judged: section.judged,
    })),
    rows,
    childCount: rows.length,
    publishedCount: rows.filter((row) => row.published).length,
    readyCount: rows.filter((row) => row.canPublish).length,
    // 「已收录 N 项内容」数的是勾选了的栏目：两个预设加上班级栏目。
    enabledCount: presetOn.length + columns.length,
    enabledNames: presetOn.map((key) => (key === 'time' ? '在园时光' : '亲子时光'))
      .concat(columns.map((section) => section.name)),
    // 矩阵里没有列的那两项，以及有列却没有判定的那几个栏目，都照实说一句为什么。
    matrixNote: (presetOn.length
      ? '矩阵只列已勾选的班级新增栏目。服务端的齐备判定按栏目的征集槽位算，'
        + '在园时光与亲子时光没有槽位，所以它们没有完成／未完成的结论。'
      : '矩阵只列已勾选的班级新增栏目。')
      + (unjudged.length
        ? `${unjudged.map((section) => section.name).join('、')}还没有征集槽位，`
          + '服务端同样不对它做齐备判定，那一列是「无判定」，不是完成。'
        : ''),
  };
}

/**
 * 「2026 春季学期编册」页要的那一份（`growth-book-edit`，成长册 → 编辑样板）。
 *
 * 列表行只显示栏目标题，自定义栏目不加类型标签（F19 第三轮）。两个预设栏目
 * 在前，班级栏目按 `section_id ASC` 在后 —— 顺序由服务端给，客户端不重排。
 */
async function loadBookEdit() {
  const compilation = await ensureCompilation();
  const sections = await listSections();
  const enabled = new Set(compilation.enabled);
  return {
    compilation,
    sections,
    rows: [
      { key: 'time', name: '在园时光', on: enabled.has('time'), custom: false, published: true },
      { key: 'task', name: '亲子时光', on: enabled.has('task'), custom: false, published: true },
    ].concat(sections.map((section) => ({
      key: section.key,
      name: section.name,
      on: enabled.has(section.key),
      custom: true,
      published: section.published,
      collecting: section.collecting,
    }))),
  };
}

/**
 * 「栏目投稿」页要的那一份（`growth-book-section-materials`）。
 *
 * **投稿的正文与照片读不到。** 契约里回 `BookMaterialSubmission` 的只有
 * `PUT /parent/growth-book/sections/{section_id}/submissions`（家长逐槽自动保存），
 * 教师端一条都没有。所以这一页只回「交齐没有」，不回投稿内容 ——
 * 与 `db/GAPS.md` **G70**（教师读不到任何一笔家长提交的内容，也拿不到它的 id）
 * 是同一族。
 *
 * 「交齐没有」要**两个条件同时成立**才有：
 *   1. 这个栏目已勾选进编册 —— 预检按 §4 规则 95 只看 `enabled_sections` 里的栏目；
 *   2. 这个栏目有征集槽位 —— 预检只在 `required_slots > 0` 时才产出
 *      `collected_incomplete`，零槽位的栏目一条 problem 都不产生。
 * 任一条不成立就没有结论，`judged` 为 false，页面照实说，**不把「没有结论」
 * 显示成「已交齐」**。
 */
async function loadSectionMaterials(sectionId) {
  const compilation = await ensureCompilation();
  const [sections, pre, children] = await Promise.all([
    listSections(),
    precheck(),
    roster.classRoster(),
  ]);
  const key = String(sectionId);
  const section = sections.find((item) => item.key === key) || null;
  const judged = !!section && section.judged && compilation.enabled.indexOf(key) >= 0;

  const byChild = new Map(pre.children.map((child) => [child.childId, child]));
  const rows = children.map((child) => {
    const row = byChild.get(child.childId);
    const missing = !!(row && row.problems.some((p) => p.sectionKey === key));
    return {
      id: child.childId,
      name: child.name,
      initial: String(child.name || '').slice(-1),
      done: judged && !!row && !missing,
      judged,
    };
  });

  return {
    compilation,
    section,
    judged,
    // 没有判定时说清是哪一条挡住的，不把没查过的那一条当成理由。
    judgeNote: judged || !section ? '' : (section.judged
      ? '这个栏目没有勾进本学期编册，服务端不对它做齐备判定，所以这一列没有结论。'
      : '这个栏目还没有家长征集槽位，服务端不对它做齐备判定，所以这一列没有结论。'),
    rows,
    doneCount: rows.filter((row) => row.done).length,
    totalCount: rows.length,
    missingIds: rows.filter((row) => !row.done).map((row) => row.id),
  };
}

/**
 * 「成长册预览」页要的抬头那一条（`growth-book-view`）。
 *
 * **这一页零写入。** 抬头要的三样都在只读端点上：姓名取班级名册，学期取会话上下文的
 * `current_term`，状态取 `GET /teacher/growth-book/precheck` 的 `book_status`。
 * **不调 `ensureCompilation()`** —— 那一条是 `POST /teacher/growth-book/compilation`
 * （NONE→e1），本学期还没有编册时它会**建出一行来**。一页写着「预览」的屏幕不许
 * 建行。本学期没有编册时预检回 409，页面照实说一句，不替教师开册。
 *
 * **只有抬头。** 整本正本要 composer 解析
 * `GET /growth-book/books/{growth_book_id}/manifest`，而那一条与按页读取都标着
 * `x-hualong-blocked-on: 0/12 released layout pack` —— 12 个版式包一个都没发布，
 * 没有 pack 可解析。所以页序、TOC 与每一页的内容今天取不到。
 *
 * 取得到的是这一名幼儿的姓名（名册）与这一本的状态（预检的 `book_status`）。
 *
 * **指名了一名幼儿却不在本班名册上时不拿别人顶上。** 名册是「查询当下仍属本班且
 * active 的幼儿」全份，所以找不到只有一个意思：这个 id 不是本班的（转班、离园，
 * 或是一条过期的链接）。此时回一句照实的话，`childId` 为 `null` ——
 * 把本班第一名幼儿的姓名与定稿状态摆在那个抬头上，是在替另一名幼儿作答。
 * 不带 `?child=` 进来是另一回事，那时按本页头注取本班第一名。
 */
async function loadChildBook(childId) {
  const [pre, children] = await Promise.all([precheck(), roster.classRoster()]);
  // 学期的名字取会话那一份（`GET /auth/session` 的 `current_term`）。编册那一条
  // 只给得出 `term_id`，而它本来就是从同一个学期派生的，所以这里不为了一个名字
  // 去打一发写入端点。会话给不出名字时回 `term_id`，编一个名字出来比显示 id 更糟。
  const term = session.getCurrentTerm();
  const label = termLabel(term && term.term_id);
  const id = Number(childId);
  const named = Number.isInteger(id);
  const child = named
    ? children.find((item) => item.childId === id) || null
    : children[0] || null;
  if (named && !child) {
    return {
      childId: null,
      name: '',
      termLabel: label,
      statusLabel: '这名幼儿不在本班名册上',
      published: false,
    };
  }
  const row = child ? pre.children.find((item) => item.childId === child.childId) : null;
  return {
    childId: child ? child.childId : null,
    name: child ? child.name : '',
    termLabel: label,
    statusLabel: row ? row.bookStatusLabel : '未建册',
    published: !!(row && row.published),
  };
}

/**
 * 全班定稿：先给选中的幼儿建册，再取一次预检的指纹，最后逐册定稿。
 *
 * **顺序不能反。** 服务端的指纹把 `db_growth_book` 的 `book_release_id` 与
 * `pack_code` 算进去了（`routes/teacher-book.mjs` 的 `contentFingerprint`），
 * 所以建册**会改指纹**。先取指纹再建册，第一发就 409 `fingerprint_drift`。
 *
 * 反过来，锁定与逐册 b1→b2 都**不改指纹**（`compilation_status` 与 `book_status`
 * 故意不在指纹里），所以 N 名幼儿共用同一个指纹，一册一发。
 *
 * 逐册各自成败：一册 409／422 不影响其余几册，因为每一发是一个独立事务。
 * 回的是三个数与失败明细，页面照实说，**不说「全部成功」**。
 */
async function publishClassBooks(childIds) {
  const ids = (childIds || []).map(Number);
  const books = [];
  const failures = [];

  for (const childId of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      books.push(await ensureBook(childId));
    } catch (err) {
      failures.push({ childId, stage: 'ensure', text: bookFailureText(err) });
    }
  }

  if (!books.length) return { published: 0, attempted: ids.length, failures };

  const pre = await precheck();
  let published = 0;
  for (const book of books) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await publishBook(book.id, pre.fingerprint);
      published += 1;
    } catch (err) {
      failures.push({ childId: book.childId, stage: 'publish', text: bookFailureText(err) });
    }
  }
  return { published, attempted: ids.length, failures };
}

/* ── 预检与错误文案 ──────────────────────────────────────────────────────── */

/**
 * 一个新增栏目可以锚在谁之后。
 *
 * 两类：五个预设正文键（`anchor_type='a2'`）与本学期其他班级栏目（`a4'`）。
 * 封面（a1）与园所栏目（a3）不给教师选 —— 新增栏目只能落在 TOC 之后的正文之间
 * （DDL 的 `anchor_after` 列注释），园所栏目也不归教师管。
 *
 * 排除自己，以及**传递地**锚在自己之后的那些栏目：选了它们就成环。
 * **下拉里挡掉只是体验，不是完整性边界**（同 W6）—— 服务端要自己重做这道校验。
 */
function anchorChoices(sections, exceptKey) {
  const blocked = new Set();
  if (exceptKey) {
    blocked.add(String(exceptKey));
    for (let grew = true; grew;) {
      grew = false;
      (sections || []).forEach((section) => {
        if (!blocked.has(section.key) && blocked.has(section.anchorAfter)) {
          blocked.add(section.key);
          grew = true;
        }
      });
    }
  }
  return PRESET_ANCHOR_KEYS
    .map((key) => ({ id: key, type: 'a2', name: `${PRESET_ANCHOR_NAMES[key]} 之后` }))
    .concat((sections || [])
      .filter((section) => !blocked.has(section.key))
      .map((section) => ({ id: section.key, type: 'a4', name: `${section.name} 之后` })));
}

/** 新建或改名栏目前的本地预检。**预检不是校验**：服务端独立再验一次。 */
function whyCannotNameSection(name, sections, exceptId) {
  const text = String(name || '').trim();
  if (!text) return '请输入栏目名称';
  if (text.length > SECTION_NAME_MAX) return `栏目名称最多 ${SECTION_NAME_MAX} 字`;
  if ((sections || []).some((s) => s.id !== exceptId && s.name === text)) return '已经有同名栏目';
  return '';
}

/**
 * 存版面前的本地预检。服务端会把同一批规则再跑一次并**拒绝整个栏目的存档**。
 *
 * 只挡本模块发得出去的那两条：至少一个组件、`literal` 文字不超过 500 字。
 * 网格越界、重叠与框太小由 `utils/growth-book.js` 的同一套函数在页面里挡。
 */
function whyCannotSaveWidgets(widgets) {
  const list = widgets || [];
  if (!list.length) return '至少放置一个组件';
  const over = list.find((w) => w.binding === 'literal'
    && widgetPlainText(w.content).length > WIDGET_CONTENT_MAX);
  if (over) return `教师自填文字最多 ${WIDGET_CONTENT_MAX} 字`;
  return '';
}

/** 锁定编册被拒时要说的话。`details.rule` 逐格译（契约的 422 清单）。 */
function lockFailureText(err) {
  const rule = err && err.details ? String(err.details.rule || '') : '';
  if (rule === 'material_without_topic') return '还有在园活动没有归入主题，请先到在园时光管理页归类';
  if (rule === 'section_incomplete') return '有栏目的内容还没齐备，请先处理再锁定';
  if (rule === 'term_message_missing') return '本学期寄语还没有填写，那一项由管理端维护';
  if (rule === 'page_count_over_limit') return '有幼儿的册子超过 200 页，请先调整班级共享内容';
  if (rule === 'cas_mismatch') return '这一页的编册数据已经过期，请退出重进后再锁定';
  const code = err ? err.code : '';
  if (code === 'revision_stale') return '这一页的编册数据已经过期，请退出重进后再锁定';
  if (code === 'state_precondition_failed') return '本学期编册已经锁定，不需要再锁一次';
  if (code === 'not_found') return '本班本学期的编册不在了，或它已经锁定，请退出重进';
  return (err && err.userMessage) || '锁定失败，请稍后重试';
}

/**
 * 栏目与版面写入被拒时要说的话。
 *
 * **每一条 `details.rule` 认两个名字。** 契约在
 * `PUT /teacher/growth-book/sections/{section_id}/widgets` 的 422 里点名六个规则码
 * （`overlap`／`min_size`／`out_of_grid`／`cross_page`／`text_exceeds_box`／
 * `literal_only_content`），服务端今天发出来的是另一套写法
 * （`no_overlap_within_page`／`min_2x2`／`within_15x24`／
 * `only_literal_may_carry_content`／`at_least_one`）。两套都译，理由与
 * `lockFailureText()` 同时认 `cas_mismatch` 与 `revision_stale` 一样：
 * **权威是契约**，只认服务端那一套的话，服务端改回契约的写法这一格就哑了。
 */
function sectionFailureText(err) {
  const rule = err && err.details ? String(err.details.rule || '') : '';
  if (rule === 'e2_is_readonly') return '本学期编册已锁定，栏目不能再改';
  if (rule === 'overlap' || rule === 'no_overlap_within_page') return '同一页上有组件重叠，服务端拒绝整个栏目的存档';
  if (rule === 'min_size' || rule === 'min_2x2') return '组件最小 2 × 2 格，请先放大';
  if (rule === 'out_of_grid' || rule === 'within_15x24') return '有组件超出版面网格，请先移回页内';
  if (rule === 'cross_page') return '有组件跨了页，版面单位是一张 A4 页，请先移回同一页';
  if (rule === 'text_exceeds_box') return '有文字超过当前框的容量，请放大框或调小字级；服务端不截断';
  if (rule === 'literal_only_content' || rule === 'only_literal_may_carry_content') return '只有教师自填文字可以带内容';
  if (rule === 'at_least_one') return '至少放置一个组件';
  const code = err ? err.code : '';
  if (code === 'state_precondition_failed') return '栏目已经发布或编册已经锁定，版面不能再改';
  if (code === 'not_found') return '这个栏目已经不在，或它已经发布、编册已经锁定';
  if (code === 'no_active_term') return '当前没有进行中的学期，暂时不能编栏目';
  return (err && err.userMessage) || '操作失败，请稍后重试';
}

/** 建册与定稿被拒时要说的话。 */
function bookFailureText(err) {
  const rule = err && err.details ? String(err.details.rule || '') : '';
  if (rule === 'requires_published_setting') return '园所的成长册设置还没有发布，教师端建不了册';
  // `POST /compilation` 的前置回的是 `requires_d2`（园所设置未发布）。少了这一格，
  // 入口页读不到编册时会落到下面的 `state_precondition_failed`，把「园所设置没发布」
  // 说成「要先锁定编册」—— 那是一句诊断错误的话。
  if (rule === 'requires_d2') return '园所的成长册设置还没有发布，本学期编册还进不去';
  // `GET /precheck` 在本学期还没有编册时回这一格。成长册预览页只读，它不会替教师
  // 建编册，所以这句话要说得出「去哪里建」，不能落到下面那句「要先锁定编册」——
  // 那是一句诊断错误的话（还没有的东西谈不上锁定）。
  if (rule === 'no_compilation_this_term') return '本班本学期还没有建立编册，请先到成长册首页建立';
  if (rule === 'page_count_over_limit') return '这一本超过 200 页，服务端不自动截断';
  const code = err ? err.code : '';
  if (code === 'fingerprint_drift') return '班级内容刚被改动，这一发零写入；请退出重进后重新定稿';
  if (code === 'state_precondition_failed') return '要先锁定编册（e1→e2）才能逐册定稿';
  if (code === 'not_found') return '这一本不在了，或编册还没有锁定';
  if (code === 'no_active_term') return '当前没有进行中的学期，暂时不能定稿';
  return (err && err.userMessage) || '定稿失败，请稍后重试';
}

module.exports = {
  SOURCE_TYPE,
  SOURCE_MOMENT,
  TOPIC_TITLE_MAX,
  listMaterials,
  listTopics,
  loadTimeManage,
  loadTaskManage,
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

  /* issue #27：编册、栏目、成册 */
  COMPILATION_STATUS,
  SECTION_STATUS,
  COLLECTION_STATUS,
  BOOK_STATUS,
  ANCHOR_TYPE,
  PRESET_ANCHOR_KEYS,
  PRESET_ANCHOR_NAMES,
  TOGGLEABLE_PRESET_KEYS,
  FIXED_SPINE_NOTE,
  SECTION_NAME_MAX,
  WIDGET_CONTENT_MAX,
  ensureCompilation,
  updateCompilation,
  lockCompilation,
  listSections,
  createSection,
  updateSection,
  deleteSection,
  saveWidgets,
  getWidgets,
  publishSection,
  withdrawCollection,
  remindSection,
  ensureBook,
  precheck,
  publishBook,
  loadBookEntry,
  loadBookEdit,
  loadSectionMaterials,
  loadChildBook,
  publishClassBooks,
  anchorChoices,
  whyCannotNameSection,
  whyCannotSaveWidgets,
  lockFailureText,
  sectionFailureText,
  bookFailureText,
};
