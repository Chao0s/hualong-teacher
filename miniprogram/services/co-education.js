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
 * ── 照片先落库，再发布 ─────────────────────────────────────────────────────
 *
 * `file_id` 收的是**已经落库的** file_id 数组（契约原话：「图片必须已经过
 * POST /media/files 落库（§8.3）；本端点不收字节」）。字节那一趟在
 * `services/media.js` 的 `uploadFile()`：签发凭证 → 传字节 → 落库，它回的
 * `file_id` 才进这里的 `fileIds`。**本模块不碰任何本地路径**。
 *
 * DO-NOT-BUILD 12：在园时光**不出现视频入口**。`wx.uploadFile` 单次 10 MB 硬上限
 * 使手机视频根本发不出去，三条出路未拍板。本模块因此没有任何视频相关的字段。
 */

const api = require('../utils/request');
const time = require('../utils/time');
const session = require('../utils/session');
const media = require('./media');

const MOMENT_PATH = '/moments';

// db_moment.publish_status —— 只有三个值，见头注。
const MOMENT_STATUS = { s1: '草稿', s3: '已发布', s5: '已撤回' };

// 周覆盖的完成线：§4 规则 1／Q59-c3。**>=2 才算完成**，0 与 1 都是未完成。
const COVERED_DONE_AT = 2;

/** 教师端总览：两项状态和三个汇总均由同一次后端查询计算。 */
async function homeSchoolProgress() {
  const result = await api.get('/home-school/progress');
  if (!result || !Array.isArray(result.children)
      || !['child_count', 'average_completion', 'reminder_count'].every((k) => Number.isFinite(result[k]))) {
    throw new Error('进度数据不完整，请稍后重试');
  }
  const statusCell = (status) => {
    if (status !== 'h1' && status !== 'h2') throw new Error('暂无法识别进度状态，请稍后重试');
    return { state: status === 'h1' ? 'done' : 'miss', label: status === 'h1' ? '已完成' : '未完成' };
  };
  return {
    metrics: [
      { label: '班级幼儿', value: String(result.child_count) },
      { label: '平均完成', value: `${result.average_completion}%` },
      { label: '待提醒', value: String(result.reminder_count), amber: true },
    ],
    rows: result.children.map((child) => ({
      childId: child.child_id,
      name: child.child_name,
      cells: [statusCell(child.moment_status), statusCell(child.parent_task_status)],
    })),
  };
}

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
    // 取地址时要一起交上去的宿主那一对（授权参数，不是统计参数）。
    // 页面原样往下传，**不在页面里写表名**。
    photoOwner: { object: media.OWNER.MOMENT, id: row.moment_id },
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
 * `owner` 是**必填的授权参数**（`{object, id}`）：同一个 file_id 允许被多条记录
 * 引用，只给 file_id 反推不出宿主，服务端就没法按宿主的规则重验调用者。少带这一对
 * 服务端回 `400 malformed_request`。每一行数据自己带着 `photoOwner`，调用方原样
 * 传下去即可。
 *
 * 请求本身走 `services/media.js` 那一条 —— 取档只有一条端点，客户端也只写一份。
 *
 * 取不到就回空串，让调用方渲染占位而不是让整页炸掉 —— 一张图打不开不该拖垮
 * 一屏动态。
 */
async function photoUrl(fileId, owner) {
  try {
    const link = await media.fileUrl(fileId, owner);
    return link.url;
  } catch (err) {
    return '';
  }
}

/**
 * 一条动态的全部照片地址，按 `file_id` 的原顺序。
 *
 * 卡片上只铺前三张，角标写「还有 N 张」。点角标要看全部，就得把剩下那些的地址
 * 也取回来 —— 卡上留的是 `fileIds`（全部），`photos[]`（只有三张）不够用。
 *
 * `owner` 是这一条记录的 `photoOwner`：**一条记录的照片同属一个宿主**，所以整批
 * 共用一对，不必逐张传。
 *
 * `known` 是卡片上已经填好的那几张，传进来就不重复取一次。
 *
 * 取不到地址的那张**直接跳过**，不放空串：`wx.previewImage` 收到空串会停在黑屏，
 * 少一张总好过卡住整个浮层。所以回来的长度可能小于 `fileIds.length`。
 */
async function photoUrls(fileIds, owner, known) {
  const cached = known instanceof Map ? known : new Map();
  const urls = await Promise.all(
    (fileIds || []).map((fileId) => cached.get(fileId) || photoUrl(fileId, owner)),
  );
  return urls.filter(Boolean);
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
    dueAt: row.due_at || '',
    hasDue: Boolean(row.due_at),

    /*
     * 两套标签，用途不同：
     *
     *   startLabel／dueLabel        到分（`YYYY-MM-DD HH:mm`），列表卡片用
     *   startDayLabel／dueDayLabel  **只到日**，详情页用
     *
     * 详情页读的是「这个任务哪天开始、哪天截止」，钟点是噪音 —— 教师挑 15:00 还是
     * 15:30 对家长没有区别。但**库里存的仍是完整时刻**（`start_at` 是 TIMESTAMP，
     * 且在 §1.2 的计划时刻白名单上），这里只是不把它全部显示出来。
     */
    startLabel: row.start_at ? time.formatStamp(row.start_at) : '',
    dueLabel: row.due_at ? time.formatStamp(row.due_at) : '',
    startDayLabel: row.start_at ? time.formatFullDay(row.start_at) : '',
    dueDayLabel: row.due_at ? time.formatFullDay(row.due_at) : '',

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
    const read = Boolean(row.read_at);
    return {
      childId: row.child_id,
      name: row.child_name,
      status: row.submission_status,
      done: isDone,
      underCheck,
      read,
      readAt: row.read_at || '',

      /*
       * **两列，不是一列。** 「读没读」与「做没做」是两件独立的事，教师看板上各占一格：
       * 挤进同一格就得造出「已读未完成」这种复合词，而它把两个维度压成一个枚举，
       * 多一种状态就要多一个词。
       *
       * 已完成的那些「已读」恒为真（打不开就交不了），所以第一列在那几行没有信息量 ——
       * 但保持列的语意一致比省几个字重要。
       */
      readLabel: read ? '已读' : '未读',
      readTone: read ? 'done' : 'miss',

      // 完成情况：审核中压过其余判断，那一笔还在微信内容检查里。
      doneLabel: underCheck ? '审核中' : (SUBMISSION_STATUS[row.submission_status] || '未知状态'),
      doneTone: underCheck ? 'wait' : (isDone ? 'done' : 'miss'),
    };
  });
  const done = rows.filter((r) => r.done).length;
  const unread = rows.filter((r) => !r.read).length;
  return {
    rows,
    summary: {
      total: rows.length,
      done,
      undone: rows.length - done,
      underCheck: rows.filter((r) => r.underCheck).length,
      // 未读：这份名单才是教师要去催的人（F24）。
      unread,
      readUndone: rows.filter((r) => r.read && !r.done).length,
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

/* ══ 社区共育 feed ═══════════════════════════════════════════════════════════
 *
 *   GET /home-school/community-feed                                    投稿流
 *   PUT /teacher/growth-book/task-submissions/{id}/inclusion           教师分支进册
 *
 * ── 一行是一笔投稿，不是一条任务 ───────────────────────────────────────────
 *
 * 社区共育**不是独立实体**（B11 拔除了 `db_community_submission`），是亲子任务与
 * 家长提交的 feed 视图。一条任务对 N 笔投稿，所以 feed 的一行是**一笔家长交上来的
 * 东西**：家长写的正文、家长拍的照片、交的时刻。
 *
 * 契约的行形状是 `ParentTaskSubmissionFeedRow` —— 在提交行上多带四项渲染卡片必需的
 * 上下文（幼儿姓名、任务标题、任务类别、教师分支进册状态），四项都是服务端派生、不落列。
 *
 * ── 只列真的交了的 ─────────────────────────────────────────────────────────
 *
 * 服务端固定筛 `submission_status='c1'`。发布时按名册预建的 `c2` 空行没有正文、
 * 没有照片、也没有 `submitted_at`，在投稿流上没有任何可显示的东西。
 * **「谁还没交」在亲子任务详情的完成情况看板上看**，两页口径刻意不同。
 *
 * ── 两个筛选都不推日期 ─────────────────────────────────────────────────────
 *
 * `time_window` 只发 `week`／`month`／`earlier` 三个字面量，**窗口边界由服务端按园所
 * 时区算**（契约原话：前端不得自行推日期）。「全部时间」与「全部任务」都表示
 * 不加该条 predicate，不是某个列值 —— 不要发 `all` 之类的字符串。
 *
 * DO-NOT-BUILD 12：与亲子任务同一条理由，**不出现视频入口**。
 */

const FEED_PATH = '/home-school/community-feed';
const INCLUSION_PATH = '/teacher/growth-book/task-submissions';

/** 契约的 `time_window` 枚举。缺席＝不加这条筛选。 */
const TIME_WINDOWS = { week: '本周', month: '本月', earlier: '更早' };

/**
 * feed 的一行。每个值都可以直接 `setData`。
 *
 * `underCheck` 为真时**不带出正文与照片**：那一笔还在微信内容检查里，没过闸门的内容
 * 不该显示出来。卡片改显示一行说明。这与完成情况看板把「审核中」当第三档是同一个口径，
 * 只是看板本来就不回正文，没有可藏的东西。
 */
function decorateFeedRow(row) {
  const underCheck = Boolean(row.under_content_check);
  return {
    id: row.parent_task_submission_id,
    taskId: row.parent_task_id,
    childId: row.child_id,

    // 卡片头部。契约不回家长姓名（也不该回），所以按幼儿姓名称呼「某某家长」。
    author: `${row.child_name}家长`,
    initial: String(row.child_name || '').slice(0, 1),

    taskTitle: row.parent_task_title || '（未命名）',
    type: row.parent_task_type,
    typeLabel: TASK_TYPE[row.parent_task_type] || '未知类型',

    underCheck,
    text: underCheck ? '' : (row.submission_text || ''),
    // 只有 id，没有地址。地址逐张走 photoUrl()，每次重验、5 分钟签名（§8.4）。
    fileIds: underCheck ? [] : (row.file_id || []),
    // 家长投稿的附件挂在这一笔提交上，取地址时要交上去（授权参数）。
    photoOwner: {
      object: media.OWNER.PARENT_TASK_SUBMISSION,
      id: row.parent_task_submission_id,
    },

    submittedAt: row.submitted_at || '',
    submittedLabel: row.submitted_at ? time.formatStamp(row.submitted_at) : '',

    // 「加入成长册」按钮的当前状态。写它走 setBookInclusion()。
    included: Boolean(row.teacher_book_included),
  };
}

/**
 * 一页社区共育 feed，新的在前。
 *
 * 排序是服务端定的 `submitted_at DESC, parent_task_submission_id DESC`，客户端不重排。
 * `type` 与 `timeWindow` 都进服务端的游标指纹：换了筛选却沿用旧游标会回
 * 400 `cursor_filter_mismatch`，不会静默返回错乱结果。
 */
async function listCommunityFeed({ type, timeWindow, cursor, limit } = {}) {
  const page = await api.getPage(FEED_PATH, {
    cursor,
    limit,
    parent_task_type: type,
    time_window: timeWindow,
  });
  return { items: page.items.map(decorateFeedRow), nextCursor: page.nextCursor };
}

/**
 * 把一笔家长投稿收进成长册（教师分支），或整笔移出。
 *
 * **两支各自独立**（F17 `task_book_branch`）：这一支不动家长那一支，也不动来源附件。
 * 有效收录 = 教师分支 OR 家长分支，两支皆 false 才完全移出。
 *
 * `fileIds` 是**整份替换**，且必须是该笔提交已冻结附件的子集 —— 服务端复验，
 * 混进别处的 file_id 回 422。移出时传空数组。
 *
 * 删除入册记录**只解除关系**：绝不删原任务、家庭提交或附件（F19）。
 */
function setBookInclusion(submissionId, { included, fileIds }) {
  return api.put(`${INCLUSION_PATH}/${submissionId}/inclusion`, {
    action: 'parent_task_submission.book_include_teacher',
    body: { teacher_book_included: included, file_id: fileIds || [] },
  });
}

/* ══ 家长评价完成情况 ═══════════════════════════════════════════════════════
 *
 *   GET /home-school/parent-evaluations                        完成情况看板
 *
 * 教师这一侧只看得到**谁交了、谁没交**。折算由服务端做（§4 规则 3）：
 * `p2 → c1 已完成`，`p0｜p1｜p3｜NULL → c2 未完成`。回包同时带折算值 `completion`
 * 与原始编码 `evaluation_status`，两者不能只留一个 —— 原始状态是家长端要显示的事实。
 *
 * ── 两列不渲染 ─────────────────────────────────────────────────────────────
 *
 * 原型的表格有四列，这里只画得出两列：
 *
 *   已读        全库没有任何「家长读过某条评价」的落点，没有 `read_at`。与亲子任务
 *               详情页删掉的那一列同一个理由（G70 同族）。
 *   提交内容预览 契约明写看板**不回 `evaluation_text`**，理由是「逐条阅读走详情端点」——
 *               但那个详情端点是 `x-hualong-roles: [parent]`，**教师到不了**。
 *               契约在这里自相矛盾，已登记为 G73。
 *
 * 没有数据源就不要渲染它，更不要编一个出来。
 */

const PARENT_EVAL_PATH = '/home-school/parent-evaluations';

// db_parent_evaluation.evaluation_type。权威是 01_schema.sql 的列注释。
const PARENT_EVAL_TYPE = { t1: '月度评价', t2: '学期评价' };

// db_parent_evaluation.evaluation_status —— 原始编码，家长端那一侧的事实。
const PARENT_EVAL_STATUS = { p0: '待填写', p1: '草稿', p2: '已提交', p3: '已逾期' };

// 服务端折算后的两档（completion_map）。
const COMPLETION = { c1: '已完成', c2: '未完成' };

// api/action-registry.tsv 的 action_key。
const PARENT_EVAL_ACTIONS = { openWindow: 'parent_evaluation.open_window' };

/**
 * 发起一次家长评价（NONE→p0），**全班 fan-out**（F26 解 G50）。
 *
 * 服务端给**发起当下**本班全部在园（`e1`）幼儿各建一行，一人一行。
 * **不发 child_id** —— 对象集合由服务端算，不由客户端指定。
 *
 * **重复发起是安全的**：唯一键 `(child_id, evaluation_type, evaluation_period)`
 * 加 `ON CONFLICT DO NOTHING`，缺行补上、已有行原样不动。**已有行的提示语不会被覆盖**
 * —— 家长可能已经照着旧提示写了一半。所以这一发不必带幂等键。
 *
 * **开窗后转入的幼儿不补行**（与亲子任务 F16 一致），因此完成情况的分母是
 * 那一期真实的行数，不是查询当下的班级人数。
 *
 * 回包是本次开窗涉及的全部行（新建的与已存在的都在内），调用方据此立刻显示分母。
 *
 * `requested_by_teacher_id`／`school_id`／`class_id` 是 derived，**不发**
 * （§7.3，DO-NOT-BUILD 8）。`start_at`／`due_at` 不在剥离清单上 —— 它们是计划时刻。
 */
async function openParentEvaluationWindow({ type, period, title, prompt, startAt, dueAt }) {
  const body = {
    evaluation_type: type,
    evaluation_period: period,
    evaluation_title: title,
    evaluation_prompt: prompt || null,
    start_at: startAt,
  };
  if (dueAt !== undefined) body.due_at = dueAt;
  const page = await api.post(PARENT_EVAL_PATH, {
    action: PARENT_EVAL_ACTIONS.openWindow,
    body,
  });
  return (page.items || []).length;
}

/**
 * 开窗前的本地检查。**预检不是校验**：服务端独立再验一次。
 *
 * 必填以 DDL 的 `NOT NULL` 为准：`evaluation_type`／`evaluation_period`／
 * `evaluation_title`／`start_at` 四个。**原型的表单只有类型与说明两格** ——
 * 那张表单在原型里根本提交不成功，与上一轮亲子任务缺 `start_at` 是同一类。
 */
function whyCannotOpenWindow({ type, period, title, startAt, dueAt }) {
  if (!PARENT_EVAL_TYPE[type]) return '请选择评价类型';
  if (!period) return '算不出评价期间，请检查当前学期';
  if (!String(title || '').trim()) return '请填写评价标题';
  if (!time.isWireTimestamp(startAt)) return '请选择开始时间';
  if (dueAt && !time.isWireTimestamp(dueAt)) return '截止时间格式不对';
  // 定长零填充的时间串，字典序等于时间序，所以直接比串。
  if (dueAt && dueAt <= startAt) return '截止时间要晚于开始时间';
  return '';
}

/**
 * 按期间分组的完成情况，新的在前。
 *
 * 「发布家长测评」那一页底下的历史列表读这个：一名幼儿一个周期一份，所以整个班取回来
 * 是**多期混在一起**，要按 `evaluation_type + evaluation_period` 折成一组一行。
 *
 * **每一组的分母是那一组真实的行数**，不是班级人数 —— 中途转入的幼儿可能没有上个月
 * 那一份，写死班级人数会让分母比分子大得莫名其妙。
 */
async function parentEvalPeriods({ limit } = {}) {
  const board = await listParentEvaluations({ limit: limit || 100 });
  const groups = [];
  const seen = new Map();
  for (const row of board.rows) {
    const key = `${row.type}|${row.period}`;
    if (!seen.has(key)) {
      const g = {
        key,
        type: row.type,
        typeLabel: row.typeLabel,
        period: row.period,
        periodLabel: row.periodLabel,
        total: 0,
        done: 0,
        read: 0,
      };
      seen.set(key, g);
      groups.push(g);
    }
    const g = seen.get(key);
    g.total += 1;
    if (row.done) g.done += 1;
    if (row.read) g.read += 1;
  }
  return groups.map((g) => ({
    ...g,
    percent: g.total ? Math.round((g.done / g.total) * 100) : 0,
    // 卡片左侧那个小方块。月度评价显示月份数字，学期评价没有月份，显示「学期」。
    mark: /^\d{4}-\d{2}$/.test(g.period) ? `${Number(g.period.slice(5, 7))}月` : '学期',
    title: `${g.periodLabel}${g.typeLabel}`,
    meta: `完成 ${g.percent}% · ${g.done}/${g.total} 已提交 · ${g.read}/${g.total} 已读`,
  }));
}

/**
 * 期间键的显示文案。
 *
 * `evaluation_period` 是**不透明字符串**，两种形状：月度评价用 `YYYY-MM`，
 * 学期评价用 `term_id`（`2025-2026-2` 之类）。
 *
 * **只有确认是 `YYYY-MM` 时才拆**，其余原样显示 —— `2025-2026-2` 不是日期，
 * 拿日期函数去解析它会得到一个看似合理的错答案（§1.2）。
 */
function evalPeriodLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period || '');
  return m ? `${m[1]}年${Number(m[2])}月` : (period || '');
}

/**
 * 一页家长评价完成情况。
 *
 * `period` 是**不透明字符串**（`YYYY-MM` 或 `term_id`），原样带过去，**不当日期解析**
 * （§1.2）—— `2025-2026-2` 不是日期。
 */
async function listParentEvaluations({ type, period, cursor, limit } = {}) {
  const page = await api.getPage(PARENT_EVAL_PATH, {
    cursor,
    limit,
    evaluation_type: type,
    evaluation_period: period,
  });
  const rows = page.items.map((row) => {
    const done = row.completion === 'c1';
    return {
      id: row.parent_evaluation_id,
      childId: row.child_id,
      name: row.child_name,
      type: row.evaluation_type,
      typeLabel: PARENT_EVAL_TYPE[row.evaluation_type] || '未知类型',
      period: row.evaluation_period || '',
      periodLabel: evalPeriodLabel(row.evaluation_period),
      // 原始编码照实带出去，客户端必须容忍未知值（§1.1）。
      status: row.evaluation_status,
      statusLabel: PARENT_EVAL_STATUS[row.evaluation_status] || '未知状态',
      completion: row.completion,
      done,
      // 已读（F24）。`read_at` 为 null 就是未读，不是错误也不是缺字段。
      read: Boolean(row.read_at),
      readLabel: row.read_at ? '已读' : '未读',
      readTone: row.read_at ? 'done' : 'miss',
      readAt: row.read_at || '',
      // 单一显示值，页面不再判一次。类名沿用 home-school-common.wxss 的三档。
      stateLabel: COMPLETION[row.completion] || '未知状态',
      stateTone: done ? 'done' : 'miss',
      submittedLabel: row.submitted_at ? time.formatStamp(row.submitted_at) : '—',
    };
  });
  const done = rows.filter((r) => r.done).length;
  const unread = rows.filter((r) => !r.read).length;
  return {
    rows,
    nextCursor: page.nextCursor,
    summary: {
      total: rows.length,
      done,
      undone: rows.length - done,
      unread,
      percent: rows.length ? Math.round((done / rows.length) * 100) : 0,
    },
  };
}

/**
 * 一份家长评价的详情，含**家长写的正文**。
 *
 * 教师端在此之前读不到任何一笔正文：看板明写不回 `evaluation_text`，而它指的
 * 「详情端点」只对家长开放。本端点是那个缺口（G73）的解，逐条读、不在列表里
 * 发全班正文。
 *
 * **只有 `p2`（已提交）才有正文。** `p0` 没填、`p1` 还在草稿、`p3` 逾期未交，
 * 服务端一律置空 —— 家长写到一半的东西不是交给教师的东西。
 */
async function getParentEvaluation(evaluationId) {
  const row = await api.get(`${PARENT_EVAL_PATH}/${evaluationId}`);
  const done = row.completion === 'c1';
  return {
    id: row.parent_evaluation_id,
    childId: row.child_id,
    name: row.child_name,
    title: row.evaluation_title || '',
    prompt: row.evaluation_prompt || '',
    // 没有正文时给空串，页面据此显示说明，**不编一句出来**。
    text: row.evaluation_text || '',
    hasText: Boolean(row.evaluation_text),
    type: row.evaluation_type,
    typeLabel: PARENT_EVAL_TYPE[row.evaluation_type] || '未知类型',
    period: row.evaluation_period || '',
    periodLabel: evalPeriodLabel(row.evaluation_period),
    status: row.evaluation_status,
    statusLabel: PARENT_EVAL_STATUS[row.evaluation_status] || '未知状态',
    done,
    stateLabel: COMPLETION[row.completion] || '未知状态',
    stateTone: done ? 'done' : 'miss',
    read: Boolean(row.read_at),
    readLabel: row.read_at ? time.formatStamp(row.read_at) : '未读',
    windowLabel: row.start_at && row.due_at
      ? `${time.formatStamp(row.start_at)} — ${time.formatStamp(row.due_at)}`
      : '',
    submittedLabel: row.submitted_at ? time.formatStamp(row.submitted_at) : '—',
  };
}

/* ══ 月度评价矩阵 ═══════════════════════════════════════════════════════════
 *
 *   GET /home-school/month-evals                               完成情况矩阵
 *
 * 矩阵是**幼儿 × 月份**。月份栏由「已存在评价记录的月份」动态生成，
 * **不写死月份清单**，也不假设 2—7 月／9—1 月（E1／E4）。
 *
 * 对外**一律二元**：`e3 → 已完成`，`e1｜e2｜无记录 → 未完成`。草稿态不对外显示 ——
 * `e1` 与 `e2` 的分界没有任何决策定义（G51），所以客户端一格都不能靠它分。
 */

const MONTH_EVAL_PATH = '/home-school/month-evals';

// db_month_eval.month_eval_status。三档只在内部用，对外折成上面那两档。
const MONTH_EVAL_STATUS = { e1: '草稿', e2: '已保存', e3: '已发布' };

/** 对外二元：只有 `e3` 算完成。未知编码一律按未完成，不放行。 */
function monthEvalDone(status) {
  return status === 'e3';
}

/**
 * 幼儿 × 月份的完成情况矩阵。
 *
 * 服务端按 `eval_month DESC, child_id ASC` 排，一页 100 行整取（本班一学期的量级）。
 * 分页仍是游标：拿不完就继续按 `nextCursor` 取，直到它为空（§3.1）。
 *
 * 月份列**从回包里出现过的月份推**，不写死，也不补齐中间没有记录的月份 ——
 * 补一个空列等于宣称那个月该有评价，而那是园所的排程，客户端不知道。
 */
async function monthEvalBoard({ month, childId, limit, termId } = {}) {
  // 缺省取会话里的当前学期。假期中没有进行中的学期，此时不加这条筛选、回全部月份。
  const term = session.getCurrentTerm();
  const useTerm = termId === undefined ? (term ? term.term_id : undefined) : termId;

  const items = [];
  let cursor;
  do {
    const page = await api.getPage(MONTH_EVAL_PATH, {
      cursor,
      limit: limit || 100,
      term_id: useTerm,
      eval_month: month,
      child_id: childId,
    });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  /*
   * 月份列 = **本学期完整覆盖的那几个月**，不是「回包里出现过的月份」。
   *
   * 两者不同，而且差别正是这张表要显示的东西：5 月、6 月还没有人写评价，
   * 回包里一行都没有 —— 但它们是本学期的月份，**该显示成一整列未完成**。
   * 按回包推列会让「整月没写」这件事从表上消失。
   *
   * 规则与服务端 `term_id` 的过滤逐字相同（契约里写着）：盖满整月才算。
   * `probe-coeducation.mjs` 断言「服务端回的月份全在客户端算出的列里」，
   * 两边漂开会当场红。
   */
  let months = [];
  if (useTerm && term && term.term_id === useTerm) {
    months = time.wholeMonthsOfTerm(term.start_date, term.end_date);
  }
  // 拿不到学期边界（换了别的学期、或假期中）就退回按数据推，倒序去重。
  if (!months.length) {
    for (const row of items) {
      if (row.eval_month && months.indexOf(row.eval_month) === -1) months.push(row.eval_month);
    }
  }
  // 单月筛选时只留那一列。
  if (month) months = months.filter((m) => m === month);

  /*
   * 行 = **本班在园名册**，不是「回包里出现过的幼儿」。
   *
   * 两者不同，差别同样是这张表要显示的东西：一名幼儿一整个学期没被写过任何评价，
   * 回包里一行都没有 —— 而他恰恰是最该出现在表上的那一个。按回包推行会让
   * 「这个孩子一次都没写」从表上消失，正好把最需要发现的情况藏起来。
   *
   * 先铺名册，再把有记录的格子填进去。
   */
  const byChild = new Map();
  for (const child of await classRoster()) {
    // 指名了某个幼儿就只铺他一行 —— 名册补齐不能把筛选盖掉。
    if (childId && child.childId !== childId) continue;
    byChild.set(child.childId, { childId: child.childId, name: child.name, cells: new Map() });
  }
  for (const row of items) {
    if (!byChild.has(row.child_id)) {
      // 名册上没有、却有评价记录：多半是已转班或离园的幼儿。照实列出来，不吞掉。
      byChild.set(row.child_id, { childId: row.child_id, name: row.child_name, cells: new Map() });
    }
    byChild.get(row.child_id).cells.set(row.eval_month, row);
  }

  const rows = [...byChild.values()]
    .sort((a, b) => a.childId - b.childId)
    .map((child) => ({
      childId: child.childId,
      name: child.name,
      states: months.map((m) => {
        const cell = child.cells.get(m);
        return cell && monthEvalDone(cell.month_eval_status) ? 'done' : 'miss';
      }),
      // 点某一格要跳去填写页，那一格对应的 month_eval_id（没有记录就是 0）。
      evalIds: months.map((m) => {
        const cell = child.cells.get(m);
        return cell ? cell.month_eval_id : 0;
      }),
    }));

  const cells = rows.length * months.length;
  const done = rows.reduce((n, r) => n + r.states.filter((s) => s === 'done').length, 0);
  return {
    months,
    // 表头只显示月份数字，`2026-04` -> `4`。逐字段读，不建 Date（§1.2）。
    monthLabels: months.map((m) => String(Number((m || '').slice(5, 7)) || '')),
    rows,
    summary: { total: cells, done, undone: cells - done },
  };
}

/* ── 月评写入 ────────────────────────────────────────────────────────────── */

// api/action-registry.tsv 的 action_key。
const MONTH_EVAL_ACTIONS = {
  saveDraft: 'month_eval.save_draft',
  publish: 'month_eval.publish',
};

/** 契约与 DDL 的上限，`db_month_eval.eval_text` 是 VARCHAR(500) 且 NOT NULL。 */
const MONTH_EVAL_TEXT_MAX = 500;

/**
 * 保存月度评价草稿（F25 解 G51）。
 *
 * 按 `child_id + eval_month` **upsert**：没有行就建一行，有行就覆盖正文。
 * **草稿一直是 `e1`**，`e2` 作废。`saved_at` **不在这一步写** —— 它由发布那一步写，
 * 因为家长端报告上那个日期取的正是它，而家长该看到的是发布日。
 *
 * 已发布（`e3`）的不能再存草稿，服务端回 409 `state_precondition_failed`。
 *
 * `teacher_id`／`class_id` 是 derived，**不发**（§7.3，DO-NOT-BUILD 8）。
 */
function saveMonthEvalDraft({ childId, month, text, fileIds }) {
  const body = { child_id: childId, eval_month: month, eval_text: text };
  // 缺席＝不动照片，空数组＝清空。两者必须分开，`?? []` 会把前者变成后者。
  if (fileIds !== undefined) body.file_id = fileIds;
  return api.put(MONTH_EVAL_PATH, { action: MONTH_EVAL_ACTIONS.saveDraft, body });
}

/**
 * 精确取某个幼儿某个月的那一笔月评，含正文与照片引用。
 *
 * 走的是同一条列表端点，两个筛选都钉死之后最多回一行 —— 契约里**没有**单笔详情端点，
 * 而按 `child_id + eval_month` 唯一（DDL 的 `uk_month_eval`），所以列表就是详情。
 * 取不到就回 `null`，调用方据此当新建处理，不抛错。
 */
async function monthEvalRow({ childId, month }) {
  const page = await api.getPage(MONTH_EVAL_PATH, {
    limit: 2, child_id: childId, eval_month: month,
  });
  const row = page.items[0];
  if (!row) return null;
  const done = monthEvalDone(row.month_eval_status);
  return {
    id: row.month_eval_id,
    childId: row.child_id,
    name: row.child_name,
    month: row.eval_month || '',
    text: row.eval_text || '',
    fileIds: row.file_id || [],
    /**
     * 月度评价的照片是**从在园时光挑进来的**，但它自己那份引用落在
     * `db_file_ref(owner_object='db_month_eval')`（E7，服务端
     * `routes/teacher.mjs:960` 就是这么写的），所以宿主是这一列评价，不是那条动态。
     *
     * 服务端按这一对宿主重验范围，规则与 `GET /home-school/month-evals` 同一条
     * （`routes/shared.mjs` 的 `fileReachable` 教师分支：`class_id` 与 `teacher_id`
     * 两个都钉）。取不到地址时这里渲染占位，不炸整屏。
     */
    photoOwner: { object: media.OWNER.MONTH_EVAL, id: row.month_eval_id },
    status: row.month_eval_status,
    statusLabel: MONTH_EVAL_STATUS[row.month_eval_status] || '未知状态',
    // 对外二元：只有 e3 算已发布。e1／e2 都是没发出去的（F25）。
    published: done,
    savedLabel: row.saved_at ? time.formatStamp(row.saved_at) : '—',
  };
}

/**
 * 发布月度评价（`e1｜e2 → e3`）。**没有回头路**，与亲子任务结束后不可重开同一条规矩。
 *
 * 服务端在同一笔事务里写 `saved_at`（F25）。请求体为空 —— 正文在草稿阶段已经写好。
 */
function publishMonthEval(monthEvalId) {
  return api.post(`${MONTH_EVAL_PATH}/${monthEvalId}/publication`, {
    action: MONTH_EVAL_ACTIONS.publish,
  });
}

/**
 * 存／发之前的本地检查。**预检不是校验**：服务端独立再验一次。
 *
 * 必填以 DDL 的 `NOT NULL` 为准：`eval_text` 是 `VARCHAR(500) NOT NULL`，所以空评语
 * 存不进去 —— 不要照原型的表单，那里可以留空。
 */
function whyCannotSaveMonthEval({ childId, month, text }) {
  if (!childId) return '请选择幼儿';
  if (!time.isPeriodKey(month) && !/^\d{4}-\d{2}$/.test(month || '')) return '请选择月份';
  if (!String(text || '').trim()) return '请填写评语';
  if (String(text).length > MONTH_EVAL_TEXT_MAX) return `评语最多 ${MONTH_EVAL_TEXT_MAX} 字`;
  return '';
}

module.exports = {
  homeSchoolProgress,
  MOMENT_STATUS,
  MAX_PHOTOS,
  COVERED_DONE_AT,
  allowedActions,
  defaultMomentDate,
  listMoments,
  getMoment,
  photoUrl,
  photoUrls,
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

  // 社区共育 feed
  TIME_WINDOWS,
  listCommunityFeed,
  setBookInclusion,

  // 家长评价完成情况
  PARENT_EVAL_TYPE,
  PARENT_EVAL_STATUS,
  COMPLETION,
  evalPeriodLabelOf: evalPeriodLabel,
  listParentEvaluations,
  parentEvalPeriods,
  openParentEvaluationWindow,
  whyCannotOpenWindow,

  // 月度评价矩阵
  MONTH_EVAL_STATUS,
  MONTH_EVAL_TEXT_MAX,
  monthEvalDone,
  monthEvalBoard,
  monthEvalRow,
  saveMonthEvalDraft,
  publishMonthEval,
  whyCannotSaveMonthEval,

  // 家长评价详情
  getParentEvaluation,
};
