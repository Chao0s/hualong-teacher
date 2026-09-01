/**
 * 家园社共育 —— 在园时光部分（`/moments` 共 5 条端点）。
 *
 * Boundary: 契约的 home-school 模块。页面 require 本模块、把返回值直接 setData，
 * **不在页面里拼 URL、不在页面里译枚举、不在页面里判状态机**。
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
};
