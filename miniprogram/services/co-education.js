/**
 * 家园社共育服务 —— 在园时光（票据 17）与亲子任务（票据 19）。
 *
 * Boundary: the 家园社共育 module, and it is also the subpackage boundary.
 * `packages/co-education` 的四个页面只读这一个服务模块 —— 一个分包一个服务模块，
 * `npm run verify:build` 拦下第二个（票据 12 定的规则）。所以两张票的写入面写在同一个
 * 文件里，分成两节；这与 services/library.js 把资源与案例的读写收在一处是同一条理由。
 *
 * Everything returned is view-ready：页面绑定它，自己不格式化、不查枚举、不拼文案。
 *
 * ── 本模块最容易写错的一处：计划时刻的字面偏移量 ─────────────────────────────
 *
 * 亲子任务的 `start_at` 与 `due_at` 是**整个教师端唯一由客户端提交的计划时刻**
 * （契约 §1.2 白名单）。偏移量是**字面量不是转换**：`Z` 或任何其他偏移量都是 422，
 * 服务端不做换算。所以本模块一次 `new Date` 也不用，全部走 `utils/time`。
 * 白名单本身也在 `utils/time`，本文件不抄第二份。
 */

const api = require('../utils/request');
const time = require('../utils/time');
const media = require('../utils/media');
const moderation = require('../utils/moderation');
const guard = require('../utils/guard');

const MOMENT_PATH = '/moments';
const PARENT_TASK_PATH = '/home-school/parent-tasks';

// 契约缺口：教师端没有名册端点（`/admin/org/children` 是 admin-pc 的）。本地契约服务
// 按 `/org/class-roster` 提供，接真服务时必须重对。已记进交接。
const ROSTER_PATH = '/org/class-roster';

// api/action-registry.tsv 的 action_key。带上它，登记册与代码可以对眼。
const ACTIONS = {
  momentCreate: 'moment.draft.create',
  momentSave: 'moment.draft.autosave',
  momentPublish: 'moment.publish',
  momentWithdraw: 'moment.withdraw',
  momentRestore: 'moment.restore',
  taskCreate: 'parent_task.create',
  taskUpdate: 'parent_task.update_draft',
  taskPublish: 'parent_task.publish',
  taskClose: 'parent_task.close',
};

// ══════════════════════════════════════════════════════════════════════════
// 名册（两节共用）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 本班名册，整取不分页（§3.5）。
 *
 * 班级不是教师能挑的东西：`class_id` 在 §7.3 是 derived，服务端按登录上下文设值，
 * 客户端提交被忽略（DO-NOT-BUILD 8）。所以这里回的是「你的班」，不是「哪个班」。
 */
async function classRoster() {
  const data = await api.get(ROSTER_PATH);
  return {
    classId: data.class_id,
    className: data.class_name || '',
    children: (data.items || []).map((c) => ({
      child_id: c.child_id,
      child_name: c.child_name,
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 在园时光（票据 17）
// ══════════════════════════════════════════════════════════════════════════
//
//   NONE --POST /moments--> s1 --publication--> s3 --withdrawal--> s5 --restoration--> s3
//   s1 --PATCH--> s1
//
// **只有三个状态**（契约 MomentStatus）：F10／Q59-k1 删掉了没有事实来源的「待审」与
// 「已驳回」—— 教师点发布即可见，**教师端没有「审核中」中间态**（D1／D2）。

// 平台与契约共同的上限：一则最多九张 distinct 图片。
const MOMENT_IMAGE_LIMIT = 9;

// 长度上限抄契约的 schema。页面用它做 maxlength 与计数，服务端仍独立复验（§6.4）。
const MOMENT_LIMITS = Object.freeze({
  moment_title: 50,
  moment_content: 600,
});

const MOMENT_STATUS = {
  s1: '草稿',
  s3: '已发布',
  s5: '已撤回',
};

/**
 * `db_file_ref.usage_key` —— 取档要按这张业务表重跑一次授权（§8.4）。
 *
 * CORRECTED 2026-08-26 —— 原值是 `moment_photo`，那是客户端自造的，**两个权威里
 * 都没有**。`db_file_ref.usage_key` 的取值集写在列注释里（`01_schema.sql:528`）：
 *   attachment｜evidence｜media｜image｜content｜material｜main_file｜inline_media｜
 *   download｜book_intro｜book_parent｜book_teacher
 * 契约的媒体端点更窄，只收 `[main_file, inline_media, download]`。
 *
 * 一个不在集合里的值不会当场报错，它会存进一张下游没人查得到的行——照片上传成功，
 * 家长那边看不到，而且没有任何东西会说出原因。
 *
 * 选 `inline_media`：在园时光的照片是随正文一起呈现的配图，与 `main_file`（一份
 * 主文件）和 `download`（供取档）都不是一回事，且它同时在 DDL 与契约的集合里。
 *
 * **这一条需要后端确认。** 语义上「在园时光的照片就是内容本身」也说得通，那更接近
 * `content` 或 `image`——但那两个不在契约的媒体枚举里，客户端选它们会被端点拒。
 * 记进交接的契约缺口：契约的媒体枚举比 DDL 的取值集窄，中间这段没有归属。
 */
const MOMENT_USAGE_KEY = 'inline_media';

/**
 * 一次逻辑发布的幂等键。
 *
 * 在教师确认发布的那一刻生成一次，之后每一次重发都复用它（§4.2）。建草稿与发布是两个
 * 端点，各要一个键，但同属一次逻辑尝试 —— 与 services/library.js 的 `newAttemptKeys`
 * 同一条理由：每次重发换新键，重复点击就会变成两则。
 */
function newMomentKeys() {
  return { create: api.uuid(), publish: api.uuid() };
}

/** 一张空的在园时光草稿。数组列给空数组而不是 null：页面按长度开合，null 会多一处判断。 */
function emptyMomentDraft(today) {
  return {
    moment_title: '',
    moment_content: '',
    moment_date: today || '',
    child_id: [],
    file_id: [],
  };
}

/**
 * 按契约的 `MomentDraftWrite` 重建请求体。
 *
 * 白名单而非黑名单：schema 是 `additionalProperties: false`，所以「只有这五个键」是契约
 * 形状本身，不是防御性代码。顺带的效果是 `school_id`／`class_id`／`teacher_id`／
 * `week_key`／`published_at` 在客户端就不存在于请求体里，而不是靠 `utils/derived` 事后
 * 剥（DO-NOT-BUILD 8，§7.3.1）。两道都在，先后不重要，缺一才重要。
 *
 * `week_key` 尤其要看清楚：它是 `moment_date` 的服务端派生列，客户端算一个发过去既不
 * 生效也不报错 —— 但算的那一步会引进一次日期运算，而这里一次也不该有。
 */
function buildMomentBody(draft) {
  const d = draft || {};
  const title = typeof d.moment_title === 'string' ? d.moment_title.trim() : '';
  const content = typeof d.moment_content === 'string' ? d.moment_content.trim() : '';
  return {
    moment_title: title === '' ? null : title,
    moment_content: content === '' ? null : content,
    moment_date: d.moment_date || null,
    child_id: (d.child_id || []).slice(),
    file_id: (d.file_id || []).slice(),
  };
}

/**
 * 发布前置，四条，抄契约的 `publishMoment`。
 *
 * **返回缺项，不返回真假**：页面要就地把它们标出来，「还不能发布」这五个字帮不了正在
 * 找原因的教师。服务端仍独立复验同样四条（§6.4）。
 */
function momentBlockers(draft) {
  const d = draft || {};
  const title = (d.moment_title || '').trim();
  const content = (d.moment_content || '').trim();
  const images = (d.file_id || []).length;
  const out = [];
  if (title.length < 1 || title.length > MOMENT_LIMITS.moment_title) {
    out.push({ key: 'moment_title', text: `活动名称要填，且不超过 ${MOMENT_LIMITS.moment_title} 字` });
  }
  if (!(d.child_id || []).length) {
    out.push({ key: 'child_id', text: '至少勾选一名本班幼儿' });
  }
  if (content.length === 0 && images === 0) {
    out.push({ key: 'moment_content', text: '活动评语与照片至少要有一样' });
  }
  if (content.length > MOMENT_LIMITS.moment_content) {
    out.push({ key: 'moment_content', text: `活动评语不超过 ${MOMENT_LIMITS.moment_content} 字` });
  }
  if (images > MOMENT_IMAGE_LIMIT) {
    out.push({ key: 'file_id', text: `照片最多 ${MOMENT_IMAGE_LIMIT} 张` });
  }
  return out;
}

/**
 * 把关路径断言，再发请求。**拒绝必须发生在网络出口之前**（ADR-0016 的阻断级不变量）。
 *
 * **这里是图文两类内容，所以两条路径都要声明**：教师写的文字走
 * `HUMAN_PREVIEW_CONFIRM`（完整预览＋明确发布），每一张上传图片走
 * `IMAGE_MEDIA_CHECK_ASYNC`（服务端 mediaCheckAsync，先发后审）。只声明一条而带了图片，
 * 图片那一类就没有声明，等同未声明 —— `assertGate` 按 `imageCount` 检查覆盖够不够。
 *
 * `claimsPending` 传 false 是有理由的：图片走先发后审，教师端没有「审核中」中间态
 * （D1／D2），界面上也确实一个字都没提。
 */
function assertMomentGate(gates, draft, state) {
  moderation.assertGate(gates, {
    what: '在园时光',
    previewedInFull: state.previewedInFull,
    confirmed: state.confirmed,
    claimsPending: false,
    imageCount: ((draft || {}).file_id || []).length,
  });
}

/**
 * 建草稿（NONE -> s1）。
 *
 * 契约要客户端「在首次有意义变更时调用一次，此后一律走 PATCH」，页面没有手动保存按钮。
 * 草稿允许不完整，完整性只在发布时验 —— 所以这一步不过 `momentBlockers`。
 *
 * **建草稿本身不携带「已发布」的语义，但它携带内容**，所以它照样过闸门：ADR-0016 的
 * 不变量是「每条 UGC 写入声明它走哪条把关路径」，不是「每次发布」。
 *
 * `previewedInFull` 与 `confirmed` 由调用方给，**不在这里写死成 true**。本页的建草稿与
 * 发布是同一次逻辑发布的两步，建草稿在前 —— 写死之后，未完整预览的那一次拒绝会发生在
 * 第二步，而第一步的请求已经发出去了。「拒绝发生在网络出口之前」因此要求第一步就问。
 *
 * 契约意义上的自动保存（教师边写边存）不走这条路：那条路径还没有页面用它，等它落地时
 * 要另想一个不假装「已经预览过」的形状，而不是把这两个参数改回写死。
 */
async function createMomentDraft({ gates, draft, previewedInFull, confirmed, idempotencyKey }) {
  assertMomentGate(gates, draft, { previewedInFull, confirmed });
  return api.post(MOMENT_PATH, {
    action: ACTIONS.momentCreate,
    idempotencyKey,
    body: buildMomentBody(draft),
  });
}

/**
 * 草稿自动保存（s1 -> s1，整份 LWW）。
 *
 * **没有 revision，不做合并，不加锁**（§5.1）：契约明写多装置并发保存是整份
 * last-write-wins，产品接受低概率内容遗失。在这条路径上加乐观锁会让自动保存不断弹冲突。
 *
 * `child_id` 与 `file_id` 是**整份替换**：本次未列出的幼儿，其 `db_moment_upload` 行被
 * 删除。所以页面必须送完整的当前名单，不能只送增量。
 */
async function saveMomentDraft({ gates, momentId, draft, previewedInFull, confirmed }) {
  assertMomentGate(gates, draft, { previewedInFull, confirmed });
  return api.patch(`${MOMENT_PATH}/${momentId}`, {
    action: ACTIONS.momentSave,
    body: buildMomentBody(draft),
  });
}

/**
 * 发布（s1 -> s3）。
 *
 * **本端点无请求体**（契约明写）—— 内容在草稿阶段已经写好，这一步只做状态转移。但它
 * 仍然过闸门，而且过的是最要紧的那一次：`HUMAN_PREVIEW_CONFIRM` 要求教师读完最终内容
 * 并另做一次确认，那两个动作就发生在这里之前。
 *
 * `published_at` 由服务端设值；客户端提交的值被静默忽略（§1.2），所以这里根本不送。
 */
async function publishMoment({ gates, momentId, draft, previewedInFull, confirmed, idempotencyKey }) {
  assertMomentGate(gates, draft, { previewedInFull, confirmed });
  return api.post(`${MOMENT_PATH}/${momentId}/publication`, {
    action: ACTIONS.momentPublish,
    idempotencyKey,
  });
}

/** 教师自行撤回（s3 -> s5）。无请求体，不携带内容，因此不过内容安全闸门。 */
function withdrawMoment(momentId, { idempotencyKey } = {}) {
  return api.post(`${MOMENT_PATH}/${momentId}/withdrawal`, {
    action: ACTIONS.momentWithdraw,
    idempotencyKey,
  });
}

/**
 * 教师自行恢复（s5 -> s3）。
 *
 * **教师不得推翻管理员撤回**（Q59-m1a）：`withdrawn_by_admin` 为真的那一笔回 409，
 * 只能由同园管理员恢复。所以列表把恢复入口只给 `withdrawn_by_admin` 为假的那些。
 */
function restoreMoment(momentId, { idempotencyKey } = {}) {
  return api.post(`${MOMENT_PATH}/${momentId}/restoration`, {
    action: ACTIONS.momentRestore,
    idempotencyKey,
  });
}

/** 列表行的形状。状态是真信息（教师看得到自己的草稿与已撤回），所以必须显示。 */
function decorateMoment(row) {
  return {
    moment_id: row.moment_id,
    moment_title: row.moment_title || '（未填名称）',
    moment_date: row.moment_date,
    week_key: row.week_key,
    excerpt: row.moment_content || '',
    child_count: (row.child_id || []).length,
    image_count: (row.file_id || []).length,
    publish_status: row.publish_status,
    // §1.1：服务端可以先于本次构建增加编码，所以每一处查表都带兜底。
    status_label: MOMENT_STATUS[row.publish_status] || '未知状态',
    status_pill: row.publish_status === 's3' ? 'hl-pill--ok'
      : row.publish_status === 's1' ? 'hl-pill--info'
        : row.publish_status === 's5' ? 'hl-pill--danger' : 'hl-pill--unknown',
    // 「这一笔 s5 是谁撤的」的唯一判据（契约 Moment.withdrawn_by_admin）。
    withdrawn_by_admin: Boolean(row.withdrawn_by_admin),
    can_restore: row.publish_status === 's5' && !row.withdrawn_by_admin,
  };
}

/**
 * 把一则在园时光的照片签成可以直接绑到 `<image src>` 的地址。
 *
 * 原型「全部活动」那一页的照片网格就是这些（园方 2026-08-27 裁定：图片区照画）。
 * **一张图一次签名** —— 契约 §4 规则 1 原话：本端点回 `file_id`，取图必须逐次走
 * `GET /media/files/{file_id}/url`，每次重验 caretaker／current class／s3，
 * 且**不提供下载、存相簿、分享、离线相簿或收藏**。
 *
 * 签不出来的那一张就不画：一个裂图比少一张图更难看懂。
 */
async function signMomentPhotos(fileIds, momentId) {
  const signed = await Promise.all((fileIds || []).map(async (fileId) => {
    try {
      const res = await api.get(`/media/files/${fileId}/url`, {
        query: { owner_object: 'db_moment', owner_id: momentId },
      });
      return { file_id: fileId, url: res.url };
    } catch (err) {
      return null;
    }
  }));
  return signed.filter(Boolean);
}

/**
 * 一页「全部活动」（原型 `home-school-moment-feed.html`）。
 *
 * 与 `listMoments` 的差别只有一处：这一页要**真的把照片画出来**，所以逐则签好地址。
 * 代价说明白：一页 20 则、每则最多 9 张，最坏情况是 180 次签名请求。原型一屏只有三则，
 * 真实一周也就三五则，所以这不是一个会失控的数 —— 但它确实随条数线性增长，
 * 换成批量端点要先改契约（§8.4 现在没有批量取档）。
 */
async function listMomentFeed({ cursor, limit } = {}) {
  const page = await api.getPage(MOMENT_PATH, { cursor, limit, publish_status: 's3' });
  const items = await Promise.all(page.items.map(async (row) => ({
    ...decorateMoment(row),
    photos: await signMomentPhotos(row.file_id, row.moment_id),
  })));
  return { items, nextCursor: page.nextCursor };
}

/** 一页在园时光，`moment_date DESC, moment_id DESC`（§3.1 游标分页）。 */
async function listMoments({ week_key: weekKey, publish_status: status, cursor, limit } = {}) {
  const page = await api.getPage(MOMENT_PATH, {
    cursor, limit, week_key: weekKey, publish_status: status,
  });
  return { items: page.items.map(decorateMoment), nextCursor: page.nextCursor };
}

/**
 * 一周的覆盖情况，名册型，**整取不分页**（§3.5）。
 *
 * 参考频率是**每周两次**：契约的计数口径写死了 `>=2` 完成、`0`／`1` 未完成，
 * 且**超过 2 照实显示不截断**（Q59-c3）。所以这个 2 不是本文件挑的一个阈值，
 * 是契约的口径，改它要先改契约。
 */
const MOMENT_WEEKLY_TARGET = 2;

async function momentWeeklyCoverage(weekKey) {
  const data = await api.get(`${MOMENT_PATH}/weekly-coverage`, {
    query: weekKey ? { week_key: weekKey } : {},
  });
  return {
    weekKey: data.week_key,
    items: (data.items || []).map((row) => ({
      child_id: row.child_id,
      count: row.moment_weekly_complete_count,
      done: row.moment_detail_week_status === 'd1',
    })),
  };
}

/**
 * 由服务端给的当前周键倒推出这一段的周键，最早在前。
 *
 * 只做**周序号减法**，不碰日期：`2026-W35` 往前六周是 `2026-W30`。跨年时序号会回绕，
 * 而客户端算不出上一年有 52 周还是 53 周 —— 那种时候这里会少列几周。**宁可少列，也不
 * 虚构一个不存在的周键**：一个不存在的周键会让服务端回一屏全零，看起来像本班那一周
 * 什么都没发。真正的解法是后端提供一个跨周端点，记在交接里。
 */
function previousWeekKeys(currentKey, span) {
  const m = /^(\d{4})-W(\d{2})$/.exec(currentKey || '');
  if (!m) return currentKey ? [currentKey] : [];
  const year = Number(m[1]);
  const week = Number(m[2]);
  const keys = [];
  for (let back = span - 1; back >= 0; back -= 1) {
    const n = week - back;
    if (n < 1) continue;
    keys.push(`${year}-W${String(n).padStart(2, '0')}`);
  }
  return keys;
}

/**
 * 把名册与各周覆盖拼成进度矩阵要的两样东西，外加汇总那两句。
 *
 * **纯函数**：喂数据进去，拿列定义与行数据出来。它在服务层而不是页面里，因为
 * `hl-progress-grid` 的接口就是「数据与列定义」—— 拼它的那一步属于服务层的
 * view-ready 责任，而不是某一页的私事。下一处同类表格照抄这个形状。
 *
 * @param {Array} children 名册，`[{ child_id, child_name }]`
 * @param {Array} weekKeys 列，最早在前
 * @param {Array} byWeek   与 weekKeys 同序的覆盖结果，`momentWeeklyCoverage` 的返回
 */
function momentProgressMatrix(children, weekKeys, byWeek) {
  const columns = weekKeys.map((key) => ({
    key,
    label: `第 ${key.replace(/^\d{4}-W0?/, '')} 周`,
  }));
  const tables = weekKeys.map((key, i) => {
    const table = {};
    ((byWeek[i] && byWeek[i].items) || []).forEach((row) => { table[row.child_id] = row; });
    return table;
  });

  let doneCells = 0;
  const rows = (children || []).map((child) => ({
    key: String(child.child_id),
    name: child.child_name,
    cells: weekKeys.map((key, i) => {
      const hit = tables[i][child.child_id];
      const count = hit ? hit.count : 0;
      const done = Boolean(hit && hit.done);
      if (done) doneCells += 1;
      return {
        key,
        done,
        // 颜色点对读屏软件是空的。这一句是它的内容，说的与颜色是同一件事。
        hint: `${child.child_name} ${key} 已发布 ${count} 次，${done ? '已达到' : '未达到'}参考频率`,
      };
    }),
  }));

  const totalCells = rows.length * weekKeys.length;
  const gap = totalCells - doneCells;
  return {
    columns,
    rows,
    summary: `${weekKeys.length} 周 × ${rows.length} 名幼儿，共 ${totalCells} 格，`
      + `已达到参考频率 ${doneCells} 格。`,
    gapText: gap === 0
      ? '这段时间每名幼儿每周都达到了参考频率。'
      : `还差 ${gap} 格没达到参考频率（每周 ${MOMENT_WEEKLY_TARGET} 次）。`
        + '点一格可以为那名幼儿的那一周发布在园时光。',
  };
}

/**
 * 亲子任务完成进度的矩阵。**同一个网格，只有一列。**
 *
 * 这一处与上面那一处的差别只有数据与列定义 —— 网格本身一行代码也不必知道自己在渲染
 * 哪一个。十三处同类表格换用它时提供的就是这两样。
 */
function taskProgressMatrix(rows) {
  return {
    columns: [{ key: 'submission', label: '完成情况' }],
    rows: (rows || []).map((row) => ({
      key: String(row.child_id),
      name: row.child_name,
      cells: [{
        key: 'submission',
        done: row.done,
        hint: `${row.child_name} ${row.done ? '已提交' : '未提交'}`
          + (row.under_content_check ? '，内容检查中' : ''),
      }],
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 亲子任务（票据 19）
// ══════════════════════════════════════════════════════════════════════════
//
//   NONE --POST--> s1 草稿 --publication--> s2 已发布 --closure--> s3 已结束
//   s1 --PATCH--> s1
//
// **没有任何回头路**（F16）：s2／s3 的时间、正文与 term_id 全部唯读，要改只能结束旧
// 任务再新建。契约里没有 s2 -> s1，也没有 s3 -> s2，所以教师端一个「重新编辑」按钮
// 也不该有。

// db_parent_task.parent_task_type —— t1／t2 是全部编码，没有「全部」。
const TASK_TYPES = [
  { key: 't1', label: '日常任务', desc: '家庭生活、亲子阅读、观察记录等日常经验' },
  { key: 't2', label: '社区任务', desc: '基于社区建筑、见闻或公共空间建立任务' },
];

const TASK_STATUS = {
  s1: '草稿',
  s2: '进行中',
  s3: '已结束',
};

// 长度上限抄契约 `ParentTaskWrite` 的 schema。
const TASK_LIMITS = Object.freeze({
  parent_task_title: 100,
  task_background: 500,
  task_detail: 1000,
});

/**
 * 客户端镜像的**计划时刻白名单**。
 *
 * 逐项镜像 `utils/time.SCHEDULED_TIME_COLUMNS`，也就是契约 §1.2 的那份具名清单。
 * 本模块到得了的只有前两列（`db_parent_task.start_at`／`due_at`），其余六列属于别的
 * 表单甚至别的客户端 —— 但镜像**整份**留在这里，因为白名单的价值就在于它是一整份：
 * 抄一半就等于把「这一列在不在白名单里」变成一个需要现场判断的问题。
 *
 * **数列表，不要相信它上面那句话**（DO-NOT-BUILD 9）：契约 §1.2 的正文写着「共 7 列」，
 * 下面的列表实际有 8 行 —— `db_party_activity.activity_at` 于 2026-08-20 补入而正文没改。
 * 列表是权威。`tests/parent-task.test.mjs` 逐项比对这份镜像与契约的列表。
 */
const SCHEDULED_TIME_COLUMNS = time.SCHEDULED_TIME_COLUMNS;

// 本模块真正提交的那两列。**白名单以外的时间列不由客户端提交** —— 送了会被服务端
// 静默忽略（§1.2 的事件时间戳一族），不报错也不生效，所以送它只是白送一个字段。
const TASK_PLANNED_FIELDS = Object.freeze(['start_at', 'due_at']);

/** 一次逻辑发布的两个幂等键。理由同 `newMomentKeys`。 */
function newTaskKeys() {
  return { create: api.uuid(), publish: api.uuid(), close: api.uuid() };
}

/** 一张空的亲子任务草稿。 */
function emptyTaskDraft() {
  return {
    parent_task_type: 't1',
    parent_task_title: '',
    task_background: '',
    task_detail: '',
    start_date: '',
    start_time: '08:00',
    due_date: '',
    due_time: '18:00',
  };
}

/**
 * 把两个 `<picker>` 给的字符串合成线上格式。
 *
 * `utils/time.fromPickerParts` 做的是**拼接**，不是换算：它把教师挑的年月日与时分原样
 * 缀上 `+08:00`。所以教师看到的 18:00 就是保存下来的 18:00 —— 中间没有任何一步会把它
 * 变成第二天凌晨，因为中间根本没有「一步」。
 *
 * 截止时间可以不设（契约：`due_at` 为 `null` 表示不设截止），所以日期为空回 null。
 */
function toPlannedTime(dateStr, timeStr) {
  if (!dateStr) return null;
  return time.fromPickerParts(dateStr, timeStr || '00:00');
}

/**
 * 按契约的 `ParentTaskWrite` 重建请求体。
 *
 * 白名单而非黑名单，理由同 `buildMomentBody`。**`term_id` 不在里面**：草稿可以没有它，
 * 它在发布时由服务端按 `start_at` 命中的园历派生并写死（§4 规则 2）。客户端猜一个
 * 学期送过去，是把「绝不猜一个学期」（§5.4）从服务端搬到了客户端。
 */
function buildTaskBody(draft) {
  const d = draft || {};
  const background = typeof d.task_background === 'string' ? d.task_background.trim() : '';
  return {
    parent_task_type: d.parent_task_type,
    parent_task_title: (d.parent_task_title || '').trim(),
    task_background: background === '' ? null : background,
    task_detail: (d.task_detail || '').trim(),
    start_at: toPlannedTime(d.start_date, d.start_time),
    due_at: toPlannedTime(d.due_date, d.due_time),
  };
}

/**
 * 缺哪些必填项。返回缺项，不返回真假 —— 与 services/library.js 的 `missingFields`
 * 同一条理由：页面要就地点名，「有东西没填」帮不了正在找它的教师。
 */
function taskBlockers(draft) {
  const body = buildTaskBody(draft);
  const out = [];
  if (TASK_TYPES.every((t) => t.key !== body.parent_task_type)) {
    out.push({ key: 'parent_task_type', text: '选一种任务类型' });
  }
  if (!body.parent_task_title) out.push({ key: 'parent_task_title', text: '任务名称要填' });
  if (!body.task_detail) out.push({ key: 'task_detail', text: '任务详情要填' });
  if (!body.start_at) out.push({ key: 'start_at', text: '开始时间要选' });
  Object.keys(TASK_LIMITS).forEach((key) => {
    const value = body[key];
    if (typeof value === 'string' && value.length > TASK_LIMITS[key]) {
      out.push({ key, text: `这一项不超过 ${TASK_LIMITS[key]} 字` });
    }
  });
  return out;
}

/**
 * 把关路径断言。
 *
 * **只有文字一条**：本页不携带图片。契约的 `ParentTaskWrite` 里没有 `file_id`，任务
 * 附件的上传端点在任何一份权威里都还没定 —— 与 services/task-submit.js 的处境相同。
 * 接上附件端点时这里加 `IMAGE_MEDIA_CHECK_ASYNC` 并把 `imageCount` 接上真实张数，
 * 两处一起改，漏一处 `assertGate` 会拦下来。
 */
function assertTaskGate(gates, state) {
  moderation.assertGate(gates, {
    what: '亲子任务',
    previewedInFull: state.previewedInFull,
    confirmed: state.confirmed,
    imageCount: 0,
  });
}

/**
 * 新建草稿（NONE -> s1）。
 *
 * `previewedInFull` 与 `confirmed` 由调用方给，**不写死成 true**：建草稿与发布是同一次
 * 逻辑发布的两步，建草稿在前 —— 写死之后，未完整预览的那一次拒绝会发生在第二步，而第
 * 一步的请求已经发出去了。理由与 `createMomentDraft` 逐字相同。
 */
async function createTaskDraft({ gates, draft, previewedInFull, confirmed, idempotencyKey }) {
  assertTaskGate(gates, { previewedInFull, confirmed });
  return api.post(PARENT_TASK_PATH, {
    action: ACTIONS.taskCreate,
    idempotencyKey,
    body: buildTaskBody(draft),
  });
}

/** 改草稿，仅 s1。非 s1 回 409 —— 发布后要改只能结束再新建（F16）。 */
async function updateTaskDraft({ gates, parentTaskId, draft, previewedInFull, confirmed }) {
  assertTaskGate(gates, { previewedInFull, confirmed });
  return api.patch(`${PARENT_TASK_PATH}/${parentTaskId}`, {
    action: ACTIONS.taskUpdate,
    body: buildTaskBody(draft),
  });
}

/**
 * 发布（s1 -> s2）。**本端点无请求体** —— 内容在草稿阶段已经写好，这一步只做状态转移
 * 与 `term_id` 派生。`published_at` 服务端设值。
 */
async function publishTask({ gates, parentTaskId, previewedInFull, confirmed, idempotencyKey }) {
  assertTaskGate(gates, { previewedInFull, confirmed });
  return api.post(`${PARENT_TASK_PATH}/${parentTaskId}/publication`, {
    action: ACTIONS.taskPublish,
    idempotencyKey,
  });
}

/** 结束（s2 -> s3）。无请求体，不携带内容，因此不过内容安全闸门。s3 没有回头路。 */
function closeTask(parentTaskId, { idempotencyKey } = {}) {
  return api.post(`${PARENT_TASK_PATH}/${parentTaskId}/closure`, {
    action: ACTIONS.taskClose,
    idempotencyKey,
  });
}

function decorateTask(row) {
  return {
    parent_task_id: row.parent_task_id,
    parent_task_title: row.parent_task_title,
    parent_task_type: row.parent_task_type,
    type_label: (TASK_TYPES.find((t) => t.key === row.parent_task_type) || {}).label || '未知类型',
    excerpt: row.task_detail || '',
    // 展示走 utils/time 的格式化：它按字符串截取，不构造 Date，所以设备时区改变不了
    // 屏幕上的数字。
    start_label: time.formatShort(row.start_at),
    due_label: row.due_at ? time.formatShort(row.due_at) : '不设截止',
    publish_status: row.publish_status,
    status_label: TASK_STATUS[row.publish_status] || '未知状态',
    status_pill: row.publish_status === 's2' ? 'hl-pill--ok'
      : row.publish_status === 's1' ? 'hl-pill--info'
        : row.publish_status === 's3' ? 'hl-pill--unknown' : 'hl-pill--unknown',
    // 只有已发布的任务有进度可看：草稿还没到家长手里，已结束的进度页仍可看。
    has_progress: row.publish_status === 's2' || row.publish_status === 's3',
  };
}

/** 一页亲子任务，`updated_at DESC, parent_task_id DESC`（§3.1 游标分页）。 */
async function listTasks({ publish_status: status, parent_task_type: type, cursor, limit } = {}) {
  const page = await api.getPage(PARENT_TASK_PATH, {
    cursor, limit, publish_status: status, parent_task_type: type,
  });
  return { items: page.items.map(decorateTask), nextCursor: page.nextCursor };
}

/** 一条亲子任务，整条。 */
function taskDetail(parentTaskId) {
  return api.get(`${PARENT_TASK_PATH}/${parentTaskId}`);
}

/**
 * 完成情况看板，名册型，**整取不分页**（§3.5）。
 *
 * `api.getRoster` 只发筛选参数，**不发 limit 也不发 cursor** —— 这是它与 `getPage` 的
 * 全部差别，也是这一条验收项的落点。缺提交行等价 `c2`，服务端已经按名册左连接补齐，
 * 所以这里拿到的一定是全班每一名幼儿，`child_id ASC`。
 */
async function taskSubmissions(parentTaskId) {
  const items = await api.getRoster(`${PARENT_TASK_PATH}/${parentTaskId}/submissions`);
  return items.map((row) => ({
    child_id: row.child_id,
    child_name: row.child_name,
    done: row.submission_status === 'c1',
    // 布尔化的「审核中」。批次键是内部工作值，教师侧没有任何依赖它的动作，所以契约
    // 不回它，这里也不造一个。
    under_content_check: Boolean(row.under_content_check),
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// 入口页与社区共育（2026-08-26 按原型建）
// ══════════════════════════════════════════════════════════════════════════
//
// 两条读面，**契约里都没有**：对象定义写在 `05 home-school-spec.md` 里
// （`db_home_school` 与 `db_home_school_progress`），`openapi.yaml` 的 149 个操作里
// 搜不到。与 `/training/home`、`/home/todos` 同类，缺口已登记。

const HOME_PATH = '/home-school/home';
const COMMUNITY_FEED_PATH = '/home-school/community-feed';

/** 入口页与社区共育共用的一张二元状态表（spec 05：h1 已完成／h2 未完成）。 */
const PROGRESS_DONE = 'h1';

/** 社区共育的任务类别筛选。两个都是查询参数，「全部」表示不加那一条 predicate。 */
const COMMUNITY_FILTERS = [
  { value: 'all', label: '全部任务' },
  { value: 't1', label: '日常任务' },
  { value: 't2', label: '社区任务' },
];

const TASK_TYPE_LABEL = { t1: '日常任务', t2: '社区任务' };

/**
 * 一个二元状态 -> `hl-progress-grid` 的一格。
 *
 * 未完成那一边的说法**逐列不同**（未完成／未提交／进行中／未定稿），所以由调用方给：
 * 组件不拼这句话，拼了就等于假设每一列的说法一样。
 */
function progressCell(key, status, undoneHint, doneHint) {
  const done = status === PROGRESS_DONE;
  return { key, done, hint: done ? (doneHint || '已完成') : undoneHint };
}

/**
 * 入口页的一次聚合读取 —— 一个请求，三个数字加一张逐儿四列的完成度表。
 *
 * 原型 `home-school.html` 的「完成度汇总」就是这一块。四列的口径都在 spec 05 的
 * `db_home_school_progress` 上：在园时光、亲子任务、成长档案、成长册，一律二元。
 */
async function homeSchoolHome() {
  const home = await api.get(HOME_PATH);
  return {
    className: home.class_name || '',
    metrics: [
      { key: 'child', value: String(home.child_count || 0), label: '班级幼儿', tint: '' },
      { key: 'average', value: `${home.average_completion || 0}%`, label: '平均完成', tint: '' },
      // 待提醒是唯一一个「越大越要留意」的数，所以只有它带颜色，与原型一致。
      { key: 'reminder', value: String(home.reminder_count || 0), label: '待提醒', tint: 'amber' },
    ],
    // `hl-progress-grid` 的行形状（票据 19）。WXML 没有表格元素，那个组件就是本仓库
    // 为「幼儿 × 状态」定下的替代形状：姓名列不随横向滚动滚走，每个点带读屏文案。
    rows: (home.items || []).map((row) => ({
      key: String(row.child_id),
      name: row.child_name,
      cells: [
        progressCell('moment', row.moment_status, '未完成'),
        progressCell('parent_task', row.parent_task_status, '未提交'),
        progressCell('growth_record', row.growth_record_status, '进行中'),
        progressCell('growth_book', row.growth_book_status, '未定稿', '已定稿'),
      ],
    })),
  };
}

/** 入口页完成度表的四列，与上面 `cells` 的下标一一对应。 */
const HOME_COLUMNS = [
  { key: 'moment', label: '在园时光' },
  { key: 'parent_task', label: '亲子任务' },
  { key: 'growth_record', label: '成长档案' },
  { key: 'growth_book', label: '成长册' },
];

/**
 * 社区共育的动态流 —— 家长对已发布亲子任务的提交。
 *
 * DECISIONS B11／E5 拔掉了 `db_community_submission`：这一页读的是亲子任务加它们的
 * 提交行，按任务类型筛。**家长内容在写下时已经过 ADR-0016 第三行的批式把关**，这里
 * 是读面，不再把一次关；仍在批次里的那些服务端不给，所以流上每一条都是过了关的。
 */
async function communityFeed({ parent_task_type: type } = {}) {
  const rows = await api.getRoster(COMMUNITY_FEED_PATH, {
    // 「全部」不是一个值，是不加这一条 predicate，所以这里送 undefined 而不是 'all'。
    parent_task_type: type && type !== 'all' ? type : undefined,
  });
  return rows.map((row) => ({
    key: `${row.parent_task_id}-${row.child_id}`,
    parent_task_id: row.parent_task_id,
    child_id: row.child_id,
    // 原型的抬头是「某某家长」：这是家长的身份，不是幼儿本人在说话。
    who: `${row.child_name}家长`,
    avatar: (row.child_name || '幼').slice(-1),
    task_title: row.parent_task_title,
    type_label: TASK_TYPE_LABEL[row.parent_task_type] || '任务',
    submitted_label: time.formatShort(row.submitted_at),
    photo_count: (row.file_id || []).length,
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// 去向
// ══════════════════════════════════════════════════════════════════════════
//
// 路径只在这里说一次，四个页面与入口页因此不可能各说各的（services/library.js 的
// `DESTINATIONS` 同一条判断）。

const MODULE_ID = 'co-education';
const PAGES = {
  momentPublish: '/packages/co-education/pages/moment/publish',
  momentProgress: '/packages/co-education/pages/moment/progress',
  taskPublish: '/packages/co-education/pages/task/publish',
  taskProgress: '/packages/co-education/pages/task/progress',
  community: '/packages/co-education/pages/community/index',
};

/**
 * 进在园时光发布页。
 *
 * `weekKey` 与 `momentId` 都是可选的：进度页点一格进来时带上周次（这就是「带上幼儿与
 * 周期」里的周期），继续改草稿时带上编号。
 */
function openMomentPublish(query) {
  const parts = [];
  if (query && query.weekKey) parts.push(`week_key=${query.weekKey}`);
  if (query && query.momentId) parts.push(`moment_id=${query.momentId}`);
  if (query && query.childId) parts.push(`child_id=${query.childId}`);
  guard.navigateTo(parts.length ? `${PAGES.momentPublish}?${parts.join('&')}` : PAGES.momentPublish, MODULE_ID);
}

function openMomentProgress() {
  guard.navigateTo(PAGES.momentProgress, MODULE_ID);
}

function openTaskPublish() {
  guard.navigateTo(PAGES.taskPublish, MODULE_ID);
}

function openTaskProgress(parentTaskId) {
  guard.navigateTo(`${PAGES.taskProgress}?parent_task_id=${parentTaskId}`, MODULE_ID);
}

function openCommunity() {
  guard.navigateTo(PAGES.community, MODULE_ID);
}

module.exports = {
  // 名册
  classRoster,
  // 在园时光
  MOMENT_IMAGE_LIMIT,
  MOMENT_LIMITS,
  MOMENT_STATUS,
  MOMENT_USAGE_KEY,
  MOMENT_WEEKLY_TARGET,
  newMomentKeys,
  emptyMomentDraft,
  buildMomentBody,
  momentBlockers,
  createMomentDraft,
  saveMomentDraft,
  publishMoment,
  withdrawMoment,
  restoreMoment,
  listMoments,
  listMomentFeed,
  momentWeeklyCoverage,
  previousWeekKeys,
  momentProgressMatrix,
  taskProgressMatrix,
  // 媒体流的三步在 utils/media，本模块只转出它要用的那几个，页面因此仍然只 require
  // 一个服务模块（分包规则），而实现只有一份。
  pickImages: media.pickImages,
  uploadPickedFile: media.uploadPickedFile,
  tooLarge: media.tooLarge,
  tooLargeReason: media.tooLargeReason,
  MAX_UPLOAD_BYTES: media.MAX_UPLOAD_BYTES,
  // 亲子任务
  TASK_TYPES,
  TASK_STATUS,
  TASK_LIMITS,
  SCHEDULED_TIME_COLUMNS,
  TASK_PLANNED_FIELDS,
  newTaskKeys,
  emptyTaskDraft,
  toPlannedTime,
  buildTaskBody,
  taskBlockers,
  createTaskDraft,
  updateTaskDraft,
  publishTask,
  closeTask,
  listTasks,
  taskDetail,
  taskSubmissions,
  // 入口页与社区共育（2026-08-26）
  COMMUNITY_FILTERS,
  HOME_COLUMNS,
  homeSchoolHome,
  communityFeed,
  // 去向
  openMomentPublish,
  openMomentProgress,
  openTaskPublish,
  openTaskProgress,
  openCommunity,
};
