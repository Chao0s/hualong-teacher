/**
 * 家园社共育 —— 在园时光（`/moments` 5 条）与亲子任务（`/home-school/parent-tasks` 7 条）。
 *
 * Boundary: 契约的 home-school 模块。页面 require 本模块、把返回值直接 setData，
 * **不在页面里拼 URL、不在页面里译枚举、不在页面里判状态机**。
 *
 * 两族的状态机形状完全不同，所以各有一张迁移表、各有一份枚举表，中间用分隔线隔开：
 * 在园时光**一次提交即 `s3`、可删不可改**；亲子任务**三态两边、可改草稿、不可删**。
 * 把它们合成一张表只会让两边都读不懂。
 *
 * ── 一次提交，可删，不可改（契约 v0.7） ────────────────────────────────────
 *
 *   `GET /moments`                  列表，回 file_id 但不回地址
 *   `GET /moments/{id}`             详情
 *   `GET /moments/weekly-coverage`  本班每名幼儿的周覆盖次数（只读派生）
 *   `POST /moments`                 一次提交即发布（NONE→s3）
 *   `DELETE /moments/{id}`          物理删除（s3→NONE）
 *
 * **没有草稿。** 教师填完点发布，客户端弹一次确认让人重看一遍，确认后直接写 `s3`。
 * **发布后正文、日期、图片与幼儿名单永久唯读**（F16），写错了删掉重发。
 * 删除连带解除入册通道与照片引用，同一交易。
 *
 * `db_moment.publish_status` 在教师端实际只会看到 `s3`：
 *   `s1` 永久空置，不会有新的写入产生它；既有旧数据仍读得到，照常渲染（GAPS G69）。
 *   `s5` **只由管理端下架产生**，教师到不了这个状态，也不能删它（治理动作优先）。
 *
 * 这些取舍的来龙去脉在 `hualong-backend/docs/API-CONTRACT.md` §15 的 v0.7。
 *
 * ── 客户端的状态判断是便利，不是边界 ───────────────────────────────────────
 *
 * `allowedActions()` 让页面知道该显示哪几个按钮，**服务端仍然独立校验每一次操作**
 * （§6.4：客户端 UI 永远不是边界）。少判一个不会放行，多判一个只会藏起一个本来
 * 就会被拒的按钮。
 *
 * ── 照片传不上去 ───────────────────────────────────────────────────────────
 *
 * `file_id` 收的是**已经落库的** file_id 数组（契约原话：「图片必须已经过
 * POST /media/files 落库（§8.3）；本端点不收字节」）。而 `POST /media/files` 与
 * `POST /media/upload-credentials` 在契约服务端都是 `not_implemented`。
 * 所以这个环境下选了照片也存不进去 —— 页面据此说明情况，不假装已上传。
 *
 * DO-NOT-BUILD 12：在园时光**不出现视频入口**。`wx.uploadFile` 单次 10 MB 硬上限
 * 使手机视频根本发不出去，三条出路未拍板。本模块因此没有任何视频相关的字段。
 */

const api = require('../utils/request');
const time = require('../utils/time');
const session = require('../utils/session');

const MOMENT_PATH = '/moments';

// db_moment.publish_status —— 只有三个值，见头注。
const MOMENT_STATUS = { s1: '草稿', s3: '已发布', s5: '已撤回' };

// 周覆盖的完成线：§4 规则 1／Q59-c3。**>=2 才算完成**，0 与 1 都是未完成。
const COVERED_DONE_AT = 2;

/** 契约的 file_id 上限，超限服务端回 422 `moment_image_limit`。 */
const MAX_PHOTOS = 9;

/* ── 状态机 ──────────────────────────────────────────────────────────────── */

/**
 * 某个状态下允许哪些动作。页面据此显示按钮。
 *
 * 写成一张表而不是一串 if：状态与动作都少，表比条件式好核对，也能被探针逐格打一遍。
 *
 * 只有一个动作：删。发布后**正文、日期、图片与幼儿名单永久唯读**（F16），
 * 所以没有 `edit`；写错了删掉重发。
 *
 * `s5` 是管理员下架的结果，教师**不能删它** —— 那已经是治理动作，不再是作者的
 * 内容决定（Q59-m1a）。服务端会回 409 `admin_action_exists`，这里先把按钮藏起来。
 */
const TRANSITIONS = {
  s1: { remove: true },   // 拍板前留下的旧草稿，作者仍可删掉
  s3: { remove: true },
  s5: { remove: false },
};

function allowedActions(status) {
  // 未知编码降级为「什么都不给做」，而不是崩溃，也不是全放开（契约要求客户端
  // 容忍未知编码；放开会让页面显示一个必然被拒的按钮）。
  return TRANSITIONS[status] || { remove: false };
}

/* ── 读 ──────────────────────────────────────────────────────────────────── */

/** 列表行与详情共用的基本形状。 */
function decorate(row) {
  const status = row.publish_status;
  return {
    id: row.moment_id,
    title: row.moment_title || '（未命名）',
    content: row.moment_content || '',
    // 契约的 `Moment` 含 `file_id`，列表与详情都回。**只有 id，没有地址** ——
    // 地址要逐张走 photoUrl()，每次重验（G16／F21）。
    fileIds: row.file_id || [],
    date: row.moment_date || '',
    // moment_date 是裸日期（LocalDate），不是时间戳，所以不走 formatDay。
    dateLabel: monthDayOf(row.moment_date),
    weekKey: row.week_key || '',
    status,
    statusLabel: MOMENT_STATUS[status] || '未知状态',
    published: status === 's3',
    publishedAt: row.published_at ? time.formatShort(row.published_at) : '',
    /**
     * 卡片上那一行时间戳，`YYYY-MM-DD HH:mm`。
     *
     * 优先用发布时刻：教师关心的是「这条什么时候发出去的」。草稿没有
     * `published_at`（拍板前的旧数据才会有草稿），退回活动日期，那时只到日不到分 ——
     * 不给一个不存在的钟点补零，`00:00` 会被读成「凌晨发的」。
     */
    stamp: row.published_at ? time.formatStamp(row.published_at) : monthDayFullOf(row.moment_date),
    can: allowedActions(status),
  };
}

/** `2026-04-21` -> `4月21日`。裸日期，逐字段读，不建 Date（§1.2 同一条理由）。 */
function monthDayOf(localDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate || '');
  if (!m) return localDate || '';
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/** `2026-04-21` 原样。裸日期没有钟点，**不补 `00:00`** —— 那会被读成凌晨发的。 */
function monthDayFullOf(localDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(localDate || '') ? localDate : (localDate || '');
}

/**
 * 一页在园时光，新的在前（§3.1 游标分页）。
 *
 * 契约给的筛选参数：`term_id`、`week_key`、`publish_status`、`child_id`、
 * `class_id`、`teacher_id`。后两个是 derived，教师端不发 —— 服务端从登录上下文
 * 自己收窄，发了也会被忽略。
 */
async function listMoments({ weekKey, status, childId, cursor, limit } = {}) {
  const page = await api.getPage(MOMENT_PATH, {
    cursor,
    limit,
    week_key: weekKey,
    publish_status: status,
    child_id: childId,
  });
  return { items: page.items.map(decorate), nextCursor: page.nextCursor };
}

/** 一条在园时光，整取。 */
async function getMoment(momentId) {
  const row = await api.get(`${MOMENT_PATH}/${momentId}`);
  const out = decorate(row);
  out.childIds = row.child_id || [];
  return out;
}

/**
 * 取一张图片的可访问地址。
 *
 * §8.4：地址**逐张逐次取**，每次重验 caretaker／当前班级／`s3`；响应里从来不含
 * 可直接访问的地址（G16／F21），所以不能把 URL 缓存进列表数据里当作长期可用。
 * 短链有效期约 5 分钟。
 *
 * 取不到就回空串，让调用方渲染占位而不是让整页炸掉 —— 一张图打不开不该拖垮
 * 一屏动态。
 */
async function photoUrl(fileId) {
  try {
    const res = await api.get(`/media/files/${fileId}/url`);
    return (res && res.url) || '';
  } catch (err) {
    return '';
  }
}

/**
 * 本班每名在园幼儿在某一周被几条 s3 覆盖。
 *
 * **这是只读派生，不落库**（契约：`writes=no`，不进 action-registry）。
 *
 * 计数口径（§4 规则 1／Q59-c1—c3）：只计 `publish_status='s3'` 且存在该幼儿
 * `db_moment_upload` 的 **distinct moment_id**；**>=2 完成，0／1 未完成，
 * 超过 2 照实显示不截断**。撤回退出聚合，恢复重新纳入。
 *
 * 对象集合是**查询当下**仍属本班且 active 的幼儿（Q59-n3／n4a）：不保存历史名册，
 * 新转入幼儿在入班前的周次可能显示 0 次。页面必须说「目前班级幼儿在所选周的记录」，
 * **不得宣称它是当周名册快照或历史稽核报表**。
 *
 * `weekKey` 省略时服务端取园所今天所在的 ISO 周。
 */
async function weeklyCoverage({ weekKey } = {}) {
  // 名册型集合，整取不分页（§3.5）。
  const items = await api.getRoster(MOMENT_PATH + '/weekly-coverage', { week_key: weekKey });
  return items.map((row) => ({
    childId: row.child_id,
    name: row.child_name,
    count: row.covered_count,
    done: row.covered_count >= COVERED_DONE_AT,
  }));
}

/**
 * 本班在园幼儿名册。
 *
 * 借的是 `weekly-coverage` —— 它按契约返回的正是「查询当下仍属本班且 active 的
 * 幼儿」全份，字段带 `child_name`。教师端**没有单独的名册端点**，而拿评估模块的
 * `/child-assessments` 当名册要跨模块耦合，还依赖「每个孩子都有评估行」这个不
 * 保证的前提。同模块内借一条只读派生，代价更小。
 */
async function classRoster() {
  const rows = await weeklyCoverage({});
  return rows.map((r) => ({ childId: r.childId, name: r.name }));
}

/**
 * 新建活动默认落在哪一天，`YYYY-MM-DD`。
 *
 * 契约（`MomentDraftWrite.moment_date`）：**必须落在当前进行中学期且不晚于园所
 * 今天**（Q59-n1）。允许补记本学期较早的周次，不允许未来日期或跨学期日期。
 *
 * 所以取「设备今天」还不够 —— 要把它夹进本学期。这不是为了迁就测试数据集：
 * 生产上同样会遇到假期里打开应用（设备今天已越过学期末）的情形，那时未夹的日期
 * 会被服务端以 422 打回，而教师看不出该改什么。夹进去之后，最坏情况是默认值落在
 * 学期最后一天，教师可以再改。
 *
 * 学期边界来自会话的 `current_term`（§6.4）。假期中没有进行中的学期，此时返回空 ——
 * 调用方据此禁用发布入口，服务端也会独立回 `409 no_active_term`。
 *
 * @param {number} nowMs 时刻（UTC 毫秒）。必填，本模块不读时钟——不可注入就测不了跨日。
 */
function defaultMomentDate(nowMs) {
  const term = session.getCurrentTerm();
  if (!term) return '';
  return time.clampLocalDate(time.todayLocalDate(nowMs), term.start_date, term.end_date);
}

/* ── 写 ──────────────────────────────────────────────────────────────────── */

// api/action-registry.tsv 的 action_key。
const ACTIONS = {
  publish: 'moment.publish',
  remove: 'moment.delete',
};

/**
 * 发布的请求体。
 *
 * **不含 school_id／class_id／teacher_id／week_key／published_at／任何 *_at** ——
 * 全是 derived 或服务端设值，提交会被忽略（§7.3，DO-NOT-BUILD 8）。契约的
 * `MomentWrite` 直接不声明它们，靠 `additionalProperties: false` 在校验阶段
 * 就说清楚。`utils/derived.js` 还会再剥一层，两道都不指望对方。
 *
 * `child_id` 与 `file_id` 都是**整份替换**，所以传完整集合，不传增量。
 */
function writeBody({ title, content, date, childIds, fileIds }) {
  const body = {};
  if (title !== undefined) body.moment_title = title;
  if (content !== undefined) body.moment_content = content;
  if (date !== undefined) body.moment_date = date;
  if (childIds !== undefined) body.child_id = childIds;
  if (fileIds !== undefined) body.file_id = fileIds;
  return body;
}

/**
 * 一次提交即发布（NONE→s3）。
 *
 * **完整性由服务端在这一步验**，`whyCannotPublish()` 只是让教师在点下去之前
 * 就知道缺什么，不是校验。
 */
function publish(draft) {
  return api.post(MOMENT_PATH, { action: ACTIONS.publish, body: writeBody(draft) });
}

/**
 * 删除自己发布的在园时光（物理删除）。
 *
 * 服务端在同一交易内连带解除入册通道（`db_growth_material`）与照片引用，
 * **即便所属编册已锁定也照解**。删掉之后周覆盖计数自动回落 —— 那是派生的，
 * 不需要客户端再做什么。
 *
 * 两种 409 值得在调用处分开处理：
 *   `author_is_caller`     不是原发布教师
 *   `admin_action_exists`  管理员已下架，教师不得推翻（Q59-m1a）
 */
function remove(momentId) {
  return api.del(`${MOMENT_PATH}/${momentId}`, { action: ACTIONS.remove });
}

/**
 * 发布前的本地检查：标题非空、至少一名幼儿、评语与照片至少有一个。
 *
 * 这是**预检不是校验**：服务端在 `POST /moments` 时独立验一次完整性，
 * 缺项回 422 并指名字段。这里存在的意义是让教师在点下去之前就知道缺什么，
 * 而不是点完等一个 422。两边的规则必须一致，改一边就要改另一边。
 */
function whyCannotPublish({ title, content, childIds, fileIds }) {
  if (!String(title || '').trim()) return '请填写活动标题';
  if (!(childIds || []).length) return '请至少选择一名幼儿';
  if (!String(content || '').trim() && !(fileIds || []).length) return '请填写观察评语或添加照片';
  if ((fileIds || []).length > MAX_PHOTOS) return `照片最多 ${MAX_PHOTOS} 张`;
  return '';
}

/* ══ 亲子任务 ═══════════════════════════════════════════════════════════════
 *
 *   GET    /home-school/parent-tasks                        列表（含草稿）
 *   POST   /home-school/parent-tasks                        建草稿（NONE→s1）
 *   GET    /home-school/parent-tasks/{id}                   详情
 *   PATCH  /home-school/parent-tasks/{id}                   改草稿，仅 s1
 *   POST   /home-school/parent-tasks/{id}/publication       发布（s1→s2）
 *   POST   /home-school/parent-tasks/{id}/closure           结束（s2→s3）
 *   GET    /home-school/parent-tasks/{id}/submissions        完成情况看板
 *
 * ── 三态两边，一条回头路都没有 ─────────────────────────────────────────────
 *
 * `s1 → s2 → s3`，契约里只有这两条边（F16）。**没有 `s2→s1`，也没有 `s3→s2`**：
 * 发布后时间、正文、附件与 `term_id` 全部唯读，要改只能关掉旧任务再建一个新的。
 * 所以「改」这个动作只在 `s1` 上存在。
 *
 * ── 计划时刻是这一族多出来的东西 ───────────────────────────────────────────
 *
 * `start_at`／`due_at` 是 §1.2 白名单上的**计划时刻**：由教师挑，客户端提交，
 * 必须带 `+08:00` 字面量。裸串与别的偏移服务端一律回 422 且**不做转换** ——
 * 转换会把教师设的 18:00 截止悄悄变成隔天 02:00。组装走 `utils/time.fromPickerParts`，
 * 那里的偏移量是字面量不是换算。
 *
 * `term_id` **不由客户端提交**：发布时服务端按 `start_at` 落在哪个园历区间派生并写死，
 * 落不进任何学期就拒绝发布（409 `no_active_term`）。它是不透明字符串，
 * **不当日期解析**（§1.2）—— `2025-2026-1` 不是日期。
 *
 * ── 看板读不到家长写了什么 ─────────────────────────────────────────────────
 *
 * `GET …/submissions` 按契约只回五个字段，**不含家长正文**，也不含单笔提交的 id。
 * 于是原型详情页的「提交预览」列没有数据源，「已读」列更是全库没有 `read_at` ——
 * 两列都不渲染（`docs/DO-NOT-BUILD.md` 的口径：没有数据源就不要渲染，更不要编一个）。
 * 已登记为 `hualong-backend/db/GAPS.md` **G70**。
 *
 * DO-NOT-BUILD 12：亲子任务**不出现视频入口**，与在园时光同一条理由。
 */

const TASK_PATH = '/home-school/parent-tasks';

// db_parent_task.parent_task_type —— 权威是 01_schema.sql 的列注释。
const TASK_TYPE = { t1: '日常', t2: '社区' };

// db_parent_task.publish_status。
const TASK_STATUS = { s1: '草稿', s2: '已发布', s3: '已结束' };

// db_parent_task_submission.submission_status。
const SUBMISSION_STATUS = { c1: '已完成', c2: '未完成' };

/** 契约的字段上限，与 DDL 的 VARCHAR 长度一致。 */
const TASK_LIMITS = { title: 100, background: 500, detail: 1000 };

/* ── 状态机 ──────────────────────────────────────────────────────────────── */

/**
 * 某个状态下允许哪些动作。写成表而不是一串 if：三个状态两条边，表比条件式好核对，
 * 也能被探针逐格打一遍。
 *
 * `edit` 只在 `s1` 为真 —— 发布后一切唯读（F16）。`close` 只在 `s2`：草稿没什么可
 * 结束的，`s3` 已经是终局。**没有任何一格给 `delete`**：契约里没有删除亲子任务的
 * 端点，这与在园时光正好相反，不要照着那边抄一个。
 */
const TASK_TRANSITIONS = {
  s1: { edit: true, publish: true, close: false },
  s2: { edit: false, publish: false, close: true },
  s3: { edit: false, publish: false, close: false },
};

function allowedTaskActions(status) {
  // 未知编码降级为「什么都不给做」（§1.1 要求客户端容忍未知编码）：不崩溃，
  // 也不全放开 —— 放开只会显示一个必然被拒的按钮。
  return TASK_TRANSITIONS[status] || { edit: false, publish: false, close: false };
}

/* ── 读 ──────────────────────────────────────────────────────────────────── */

/**
 * 列表行与详情共用的形状。每个值都可以直接 `setData`。
 *
 * 完成率两个数（`done_count`／`roster_count`）是服务端的**派生值**，同口径同集合：
 * `roster_count` 与看板的行数是同一个集合。它**不是发布当时的名册快照** ——
 * 发布后转入的幼儿计进分母且没有提交行，于是显示未完成。所以文案只能说
 * 「目前班级幼儿」，**不得说成当时名册或历史稽核数**。
 */
function decorateTask(row) {
  const status = row.publish_status;
  const done = Number(row.done_count) || 0;
  const roster = Number(row.roster_count) || 0;
  return {
    id: row.parent_task_id,
    type: row.parent_task_type,
    typeLabel: TASK_TYPE[row.parent_task_type] || '未知类型',
    community: row.parent_task_type === 't2',
    title: row.parent_task_title || '（未命名）',
    background: row.task_background || '',
    detail: row.task_detail || '',

    // 线上原值留着回填表单（picker 要拆回年月日时分），标签给渲染。
    startAt: row.start_at || '',
    startLabel: row.start_at ? time.formatStamp(row.start_at) : '',
    dueAt: row.due_at || '',
    dueLabel: row.due_at ? time.formatStamp(row.due_at) : '',
    hasDue: Boolean(row.due_at),

    status,
    statusLabel: TASK_STATUS[status] || '未知状态',
    isDraft: status === 's1',
    published: status === 's2',
    closed: status === 's3',

    // 期间键是不透明串，原样带过去（§1.2）。草稿还没有它。
    termId: row.term_id || '',
    publishedAt: row.published_at || '',
    publishedLabel: row.published_at ? time.formatDay(row.published_at) : '',

    doneCount: done,
    rosterCount: roster,
    // 草稿一条提交都不会有，`0/N 完成` 是一个必然的 0，显示它没有信息量。
    showProgress: status !== 's1',
    doneLabel: `${roster} 人中 ${done} 人完成`,
    donePercent: roster ? Math.round((done / roster) * 100) : 0,

    can: allowedTaskActions(status),
  };
}

/**
 * 一页亲子任务。
 *
 * 契约给的筛选：`publish_status` 与 `parent_task_type`。两个都**缺席即不加该条
 * predicate** —— 「全部」不是一个列值，不要发 `all` 之类的字符串。
 * `class_id` 是 derived，教师端不发。
 *
 * 排序是服务端定的 `updated_at DESC, parent_task_id DESC`，客户端不重排。
 */
async function listTasks({ status, type, cursor, limit } = {}) {
  const page = await api.getPage(TASK_PATH, {
    cursor,
    limit,
    publish_status: status,
    parent_task_type: type,
  });
  return { items: page.items.map(decorateTask), nextCursor: page.nextCursor };
}

/** 一条亲子任务，整取。 */
async function getTask(taskId) {
  return decorateTask(await api.get(`${TASK_PATH}/${taskId}`));
}

/**
 * 完成情况看板：本班每名在园幼儿一行。
 *
 * 名册型集合，整取不分页（§3.5）。缺提交行等价 `c2`，服务端已经折算好。
 *
 * 三档而不是两档：`under_content_check` 为真时**优先显示「审核中」** ——
 * 那一笔正在微信内容检查里，既不是已完成也不是家长没交，对教师来说是第三种情况。
 * 状态编码本身仍照实带出去。
 */
async function submissionBoard(taskId) {
  const items = await api.getRoster(`${TASK_PATH}/${taskId}/submissions`);
  const rows = items.map((row) => {
    const underCheck = Boolean(row.under_content_check);
    const isDone = row.submission_status === 'c1';
    return {
      childId: row.child_id,
      name: row.child_name,
      status: row.submission_status,
      done: isDone,
      underCheck,
      // 单一显示值，页面不再判一次。类名沿用 home-school-common.wxss 的三档。
      stateLabel: underCheck ? '审核中' : (SUBMISSION_STATUS[row.submission_status] || '未知状态'),
      stateTone: underCheck ? 'wait' : (isDone ? 'done' : 'miss'),
      submittedLabel: row.submitted_at ? time.formatStamp(row.submitted_at) : '—',
    };
  });
  const done = rows.filter((r) => r.done).length;
  return {
    rows,
    summary: {
      total: rows.length,
      done,
      undone: rows.length - done,
      underCheck: rows.filter((r) => r.underCheck).length,
      percent: rows.length ? Math.round((done / rows.length) * 100) : 0,
    },
  };
}

/* ── 写 ──────────────────────────────────────────────────────────────────── */

// api/action-registry.tsv 的 action_key。
const TASK_ACTIONS = {
  create: 'parent_task.create',
  updateDraft: 'parent_task.update_draft',
  publish: 'parent_task.publish',
  close: 'parent_task.close',
};

/**
 * 写入体。
 *
 * **不含 school_id／class_id／teacher_id／term_id／published_at** —— 全是 derived
 * 或服务端派生（§7.3，DO-NOT-BUILD 8）。`utils/derived.js` 还会再剥一层。
 * `start_at`／`due_at` **不在**那份剥离清单上，它们是计划时刻，要发出去。
 *
 * `undefined` 表示本次不带这个字段（PATCH 的「不改」），`null` 表示清空。
 * 两者必须分开：`?? null` 会把「不改」变成「清空」。
 */
function taskWriteBody({ type, title, background, detail, startAt, dueAt }) {
  const body = {};
  if (type !== undefined) body.parent_task_type = type;
  if (title !== undefined) body.parent_task_title = title;
  if (background !== undefined) body.task_background = background;
  if (detail !== undefined) body.task_detail = detail;
  if (startAt !== undefined) body.start_at = startAt;
  if (dueAt !== undefined) body.due_at = dueAt;
  return body;
}

/** 建草稿（NONE→s1）。草稿没有 `term_id`，发布时才派生。 */
async function createTaskDraft(form) {
  return decorateTask(await api.post(TASK_PATH, {
    action: TASK_ACTIONS.create,
    body: taskWriteBody(form),
  }));
}

/** 改草稿（仅 s1）。非 s1 服务端回 409 `state_precondition_failed`。 */
async function updateTaskDraft(taskId, form) {
  return decorateTask(await api.patch(`${TASK_PATH}/${taskId}`, {
    action: TASK_ACTIONS.updateDraft,
    body: taskWriteBody(form),
  }));
}

/**
 * 发布（s1→s2）。请求体为空 —— 内容在草稿阶段已经写好，这一步只做状态转移与派生。
 *
 * 服务端在同一事务里按 `start_at` 派生 `term_id` 并写死。此后跨学期改 `start_at`
 * 一律拒绝，提交晚于学期边界也不改变归属。
 */
async function publishTask(taskId) {
  return decorateTask(await api.post(`${TASK_PATH}/${taskId}/publication`, {
    action: TASK_ACTIONS.publish,
  }));
}

/**
 * 结束（s2→s3）。**没有回头路**，契约里没有 `s3→s2` 这条边，要重开只能新建（F16）。
 *
 * 关闭后尚未提交的那几笔立即退出家长端待处理提醒，且**不得冒充完成** ——
 * 家园共育历史保留一列并标示「已结束・未提交」（F11／Q60-l）。
 */
async function closeTask(taskId) {
  return decorateTask(await api.post(`${TASK_PATH}/${taskId}/closure`, {
    action: TASK_ACTIONS.close,
  }));
}

/* ── 表单辅助 ────────────────────────────────────────────────────────────── */

/**
 * 新任务默认的开始时刻，`YYYY-MM-DDTHH:mm:ss+08:00`。
 *
 * 取园所今天的 08:00。**不夹进学期** —— 与在园时光的 `moment_date` 不同，草稿的
 * `start_at` 落在哪一天契约都不管，只有**发布**那一步要求它落进某个学期区间。
 * 夹进当前学期反而会在假期里把默认值推到上学期最后一天，那不是教师想要的开始日。
 * 落不进学期时服务端在发布时回 409，`publishFailureText()` 把它译成看得懂的一句。
 *
 * @param {number} nowMs 时刻（UTC 毫秒）。必填，本模块不读时钟。
 */
function defaultTaskStart(nowMs) {
  return time.fromPickerParts(time.todayLocalDate(nowMs), '08:00');
}

/**
 * 把 `<picker>` 的两个字符串拼成线上值。`date` 是 `YYYY-MM-DD`，`clock` 是 `HH:mm`。
 *
 * 页面只管把 picker 给的两个串交上来，偏移量与格式在这里定 —— 页面不拼时间戳。
 */
function taskWireTime(date, clock) {
  return time.fromPickerParts(date, clock);
}

/**
 * 把线上值拆回 picker 要的两个串。`{ date, clock }`，拆不开就回空串。
 *
 * 走 `parseWireTimestamp` 逐字段读，**不建 Date** —— `new Date(str).getHours()` 会按
 * 运行这台机器的时区读回来，那正是 §1.2 要消掉的歧义。
 */
function taskPickerParts(wire) {
  const p = time.parseWireTimestamp(wire);
  if (!p) return { date: '', clock: '' };
  const pad2 = (n) => String(n).padStart(2, '0');
  return {
    date: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
    clock: `${pad2(p.hour)}:${pad2(p.minute)}`,
  };
}

/**
 * 建立／保存前的本地检查。
 *
 * **预检不是校验**：服务端独立再验一次，缺项回 422 并指名字段。这里存在的意义是让
 * 教师在点下去之前就知道缺什么。两边的规则必须一致，改一边就要改另一边。
 *
 * 必填以 DDL 的 `NOT NULL` 为准：`parent_task_type`、`parent_task_title`、
 * `task_detail`、`start_at` 四个。`task_background` 与 `due_at` 可空 ——
 * 原型的表单没有时间输入框，那是原型漏了一个 `NOT NULL` 列，不是契约不要它。
 */
function whyCannotSaveTask({ type, title, detail, startAt, dueAt }) {
  if (!TASK_TYPE[type]) return '请选择任务类型';
  if (!String(title || '').trim()) return '请填写任务名称';
  if (String(title).length > TASK_LIMITS.title) return `任务名称最多 ${TASK_LIMITS.title} 字`;
  if (!String(detail || '').trim()) return '请填写任务详情';
  if (String(detail).length > TASK_LIMITS.detail) return `任务详情最多 ${TASK_LIMITS.detail} 字`;
  if (!time.isWireTimestamp(startAt)) return '请选择开始时间';
  if (dueAt && !time.isWireTimestamp(dueAt)) return '截止时间格式不对';
  // 定长零填充的时间串，字典序等于时间序，所以直接比串。
  if (dueAt && dueAt <= startAt) return '截止时间要晚于开始时间';
  return '';
}

/**
 * 把发布失败译成教师看得懂的一句。
 *
 * 只译这一族**特有**的两个码，其余交回 `errors.js` 的通用文案：
 *
 *   `no_active_term`             通用文案是「当前没有进行中的学期」，在这里是错的 ——
 *                                服务端拒绝的理由是**这个任务的开始时间**落不进任何
 *                                学期区间，跟「今天是不是假期」无关。
 *   `state_precondition_failed`  这个任务已经不是草稿了（多半是另一处已经发过）。
 */
function publishFailureText(err) {
  if (err && err.code === 'no_active_term') {
    return '开始时间不在任何一个学期内，请改到学期内的日期再发布';
  }
  if (err && err.code === 'state_precondition_failed') {
    return '这个任务已经发布过了，请返回列表刷新';
  }
  return (err && err.userMessage) || '发布失败，请稍后重试';
}

module.exports = {
  MOMENT_STATUS,
  MAX_PHOTOS,
  COVERED_DONE_AT,
  allowedActions,
  defaultMomentDate,
  listMoments,
  getMoment,
  photoUrl,
  weeklyCoverage,
  classRoster,
  publish,
  remove,
  whyCannotPublish,

  // 亲子任务
  TASK_TYPE,
  TASK_STATUS,
  SUBMISSION_STATUS,
  TASK_LIMITS,
  allowedTaskActions,
  listTasks,
  getTask,
  submissionBoard,
  createTaskDraft,
  updateTaskDraft,
  publishTask,
  closeTask,
  defaultTaskStart,
  taskWireTime,
  taskPickerParts,
  whyCannotSaveTask,
  publishFailureText,
};
