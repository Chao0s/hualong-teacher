/**
 * Local mock of the Hualong API, for developing the teacher client before the
 * real service exists.
 *
 * This is NOT a stub that returns whatever is convenient. It implements the
 * parts of API-CONTRACT.md v0.5 that the client depends on, so that code written
 * against it is code that will work against the real instance:
 *
 *   §1.4  X-Request-Id echoed on every response; Retry-After on 429/503
 *   §2.1  resources at the top level; collections as { items, next_cursor }
 *   §2.2  one error shape, with details carrying field+rule and never a value
 *   §2.3  the status-code split, including scope-miss -> 404 not 403
 *   §3.1  cursor pagination; no offset, no page, no total
 *   §3.3  opaque cursors bound to a filter fingerprint
 *   §3.5  roster-shaped collections return whole, ordered by child_id ASC
 *   §4    Idempotency-Key: replay returns the original status and body
 *   §6.2  the two-stage login, including the 409 that triggers stage two
 *
 * Run:  node mock/server.mjs
 *       node mock/server.mjs --unbound     start with no openid bound, to
 *                                          exercise the stage-2 phone flow
 *       node mock/server.mjs --no-term     current_term = null (holiday)
 *
 * Secrets: none live here. The mock never calls WeChat. `code2session` and
 * `getRealtimePhoneNumber` are simulated, which is the whole reason a sandbox
 * AppID is enough to develop against it.
 */

import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROLE_BY_SURFACE, authorizeRole, RoleResolutionError } from './authz.mjs';
import { loadRoutes } from './spec-routes.mjs';

// 3000 and 3100 are already taken by another local service on this workstation,
// so the default is moved out of the common range. Override with PORT=.
const PORT = Number(process.env.PORT || 3820);
const BASE = '/api/v1';
const ARGV = new Set(process.argv.slice(2));
const OPTS = {
  startUnbound: ARGV.has('--unbound'),
  noTerm: ARGV.has('--no-term'),
};

// ── Fixture data ───────────────────────────────────────────────────────────

const TEACHER = {
  teacher_id: 12,
  teacher_name: '陈静',
  teacher_status: 's1',
};

const SCOPE = { school_id: 1, class_id: 3, class_name: '中二班' };

const TERM = {
  term_id: '2026-2027-1',
  term_name: '2026学年第一学期',
  start_date: '2026-09-01',
  end_date: '2027-01-15',
};

const NOTICE_TITLES = [
  '关于秋季开学第一周作息安排的通知',
  '资源库新增「番禺水乡」主题资源包',
  '本学期教研培训计划与研修安排',
  '关于成长册园所设置发布的说明',
  '幼儿健康档案信息核对提醒',
  '食堂食谱公示与过敏原登记',
];

const NOTICE_BODY = [
  '各位老师：',
  '',
  '请于本周五下班前完成相关信息核对，并在平台内确认。若有疑问，请联系保教主任或信息员。',
  '',
  '化龙镇中心幼儿园',
].join('\n');

// 26 notices, so cursor paging actually pages. Newest first, matching the
// contract's "business time DESC + primary key DESC" ordering.
const NOTICES = Array.from({ length: 26 }, (_, i) => {
  const id = 26 - i;
  const day = String(20 - (i % 20)).padStart(2, '0');
  return {
    notice_id: id,
    notice_title: NOTICE_TITLES[i % NOTICE_TITLES.length],
    notice_body: NOTICE_BODY,
    published_at: `2026-08-${day}T09:${String(10 + (i % 45)).padStart(2, '0')}:00+08:00`,
  };
});

// db_home_case — 教师端首页推荐案例. Curated by an administrator in the PC
// backend (APP-STRUCTURE 首页推荐课程案例管理),同年级按 updated_at DESC 取前三.
// It is a curated shelf, not a per-teacher recommendation: no profile, no
// ranking signal, nothing derived from what this teacher read (ADR-0011).
const HOME_CASES = [
  { case_id: 71, case_name: '祠堂里的故事', case_field: 'f3', case_grade: 'k2' },
  { case_id: 68, case_name: '龙舟竞渡', case_field: 'f1', case_grade: 'k2' },
  // A field code this client build does not know, same purpose as the todo
  // below: the shelf must still render (§1.1).
  { case_id: 64, case_name: '醒狮从哪里来', case_field: 'f9_future_field', case_grade: 'k2' },
];

// db_task + db_task_assign。教师看到的是**自己那一行** assign（契约 §7.3：
// teacher_id 派生），同事的执行状态不回。
// 15 条，够翻页；状态覆盖 a1/a2/a3 与 t1/t2/t3/t4，另含一个本客户端不认识的
// 状态码，用来验证枚举降级（§1.1）。
const TASK_TITLES = [
  '衣食住行艺课程资源包共建',
  '社区建筑观察活动材料提交',
  '课程游戏化研修反馈汇总',
  '班级主题墙秋季素材征集',
  '幼儿一日生活流程优化建议',
];

const TASK_INTRO = '围绕五类生活经验收集班级实践材料，形成可进入资源库和案例库的素材包。';
const TASK_DIVISION = '各班收集不少于 10 张实践照片与 1 份教师转化说明，于截止日前提交。';

const TASKS = Array.from({ length: 15 }, (_, i) => {
  const id = 15 - i;
  // 前 5 条进行中，中间 5 条待接收，其余已完成；第 13 条已取消。
  const assignStatus = i < 5 ? 'a2' : i < 10 ? 'a1' : 'a3';
  let taskStatus = i < 5 ? 't2' : i < 10 ? 't1' : 't3';
  if (id === 3) taskStatus = 't4';
  // 一个未来版本才有的状态码：客户端必须照常显示，不得崩、不得留空。
  if (id === 7) taskStatus = 'z9_future_status';
  return {
    task_id: id,
    task_title: TASK_TITLES[i % TASK_TITLES.length],
    task_intro: TASK_INTRO,
    task_division: TASK_DIVISION,
    due_at: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T18:00:00+08:00`,
    task_status: taskStatus,
    creator_type: i % 3 === 0 ? 'c2' : 'c1',
    assign: {
      assign_id: 500 + id,
      task_id: id,
      teacher_id: 12,
      assign_status: assignStatus,
      accepted_at: assignStatus === 'a1' ? null : '2026-08-20T09:00:00+08:00',
      completed_at: assignStatus === 'a3' ? '2026-08-22T16:30:00+08:00' : null,
      feedback: null,
    },
  };
});

// db_party_study —— 党建学习资料。契约 §4 规则 19：按 published_at DESC, study_id
// DESC 作游标分页，**不搜索、不筛选** —— `study_type` 只显示，不做成筛选项（F7），
// 所以本端点除分页对之外不收任何参数。
// 23 条，够翻页（limit 缺省 20）；第 7 条带一个本客户端不认识的类型码，用来验证枚举
// 降级（§1.1）；第 4 条没有发布部门，用来验证可空列不把界面撑塌。
const STUDY_TITLES = [
  '新时代幼儿园党建工作要点',
  '师德师风专题学习材料',
  '校园安全责任清单学习',
  '支部会议记录规范',
  '党员学习档案整理要求',
];

const STUDY_DEPARTMENTS = ['办公室', '党支部', '综合组'];

const STUDY_CONTENT = [
  '一、指导思想',
  '',
  '围绕党建引领幼儿园高质量发展，明确支部学习、党员示范岗、课程建设协同和家园社共育服务四项重点，把学习成果落到班级一日生活里。',
  '',
  '二、学习要求',
  '',
  '各年级组每月组织一次集中学习，教师在平台内读完全文并完成学习记录。本文件同时用于园内归档。',
].join('\n');

const PARTY_STUDIES = Array.from({ length: 23 }, (_, i) => {
  const id = 23 - i;
  const day = String(20 - (i % 20)).padStart(2, '0');
  return {
    study_id: id,
    study_title: STUDY_TITLES[i % STUDY_TITLES.length],
    study_type: id === 7 ? 'z9_future_type' : ['t1', 't2', 't3'][i % 3],
    study_content: STUDY_CONTENT,
    publisher_department: id === 4 ? null : STUDY_DEPARTMENTS[i % 3],
    published_at: `2026-06-${day}T09:${String(10 + (i % 45)).padStart(2, '0')}:00+08:00`,
    // 本模块只产生 s3（直发）与 s5（下线）；列表与详情的可见范围都是 s3。
    study_status: 's3',
    // 外部影片，不上传到本后端、不由小程序内嵌播放（F7）。第 4 条为 null，因为契约
    // 允许该列为空，客户端不得把 null 当成数组。
    video_links: id === 4 ? null : [
      { title: '党建引领教育高质量发展', url: 'https://www.12371.cn/special/xxzd/' },
      { title: '师德师风专题学习', url: 'https://www.xuexi.cn/' },
    ],
    // 契约要求至少一份 usage_key='main_file'（F7），所以每条都有；配图只有部分条目有。
    file_refs: [
      { file_id: 7000 + id, usage_key: 'main_file', file_name: `${STUDY_TITLES[i % STUDY_TITLES.length]}.pdf`, file_size: 2483712 },
      ...(id % 4 === 0 ? [] : [
        { file_id: 7500 + id, usage_key: 'inline_media', file_name: '学习现场照片.jpg', file_size: 384210 },
      ]),
    ],
  };
});

/** 列表卡片：`excerpt` 由 `study_content` 前 100 字派生，**不落摘要列**（F7）。 */
function toStudyCard(study) {
  return {
    study_id: study.study_id,
    study_title: study.study_title,
    study_type: study.study_type,
    publisher_department: study.publisher_department,
    published_at: study.published_at,
    excerpt: study.study_content.slice(0, 100),
  };
}

const TODOS = [
  { todo_id: 1, todo_kind: 'upload', todo_title: '上传「祠堂里的故事」课程案例', due_at: '2026-08-25T18:00:00+08:00' },
  { todo_id: 2, todo_kind: 'task', todo_title: '完成共建任务：秋季主题墙素材征集', due_at: '2026-08-28T18:00:00+08:00' },
  { todo_id: 3, todo_kind: 'evaluation', todo_title: '填写 8 月月度评价（还差 6 名幼儿）', due_at: '2026-08-31T18:00:00+08:00' },
  // An intentionally unknown kind: the client must degrade to a neutral pill
  // rather than crash (§1.1's tolerate-unknown-enums rule).
  { todo_id: 4, todo_kind: 'z9_future_kind', todo_title: '未来版本新增的待办类型', due_at: null },
];

// ── Mutable state ──────────────────────────────────────────────────────────

// Per-request logging is wanted at the CLI and unwanted inside a test run.
const runtime = { quiet: false };
const rlog = (...a) => { if (!runtime.quiet) console.log(...a); };

const state = {
  openidBound: !OPTS.startUnbound,
  sessions: new Map(),          // token -> { claim_id, issued_at }
  revoked: new Set(),
  idempotency: new Map(),       // key -> { status, body, bodyHash }
  nextTaskId: 900,              // POST /parent-tasks assigns from here
};

// §3.5 — a roster-shaped collection: one row per child, whole, child_id ASC.
// Deliberately NOT paginated; "is anyone incomplete?" must be one read.
const ROSTER = Object.freeze([
  { child_id: 101, child_name: '陈一诺', submission_status: 'p2' },
  { child_id: 102, child_name: '黄铭轩', submission_status: 'p1' },
  { child_id: 103, child_name: '梁子墨', submission_status: 'p2' },
  { child_id: 104, child_name: '罗芷晴', submission_status: 'p1' },
  { child_id: 105, child_name: '吴悦然', submission_status: 'p2' },
  { child_id: 106, child_name: '郑皓宇', submission_status: 'p1' },
]);

// ── Contract helpers ───────────────────────────────────────────────────────

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, {
    // §1.1: one content type, both directions.
    'content-type': 'application/json; charset=utf-8',
    // §1.4: no-store on anything that could carry minors' data or a signed URL.
    // Blanket here rather than per-route, because getting the list wrong is a
    // red-line-4 leak and the cost of over-applying it is zero.
    'cache-control': 'no-store',
    'x-request-id': res.__requestId,
    // §5.3: rate-limit headers are always present, even well under the limit.
    'x-ratelimit-limit': '3000',
    'x-ratelimit-remaining': '2999',
    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
    // CORS for the DevTools simulator, which issues real cross-origin requests.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,authorization,idempotency-key,x-request-id',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    ...extraHeaders,
  });
  res.end(payload);

  // §4.2: record the first outcome so a replay can return the original status
  // and body. 5xx is deliberately not recorded — replaying "our bug" would pin
  // a transient failure to the key for its whole lifetime.
  if (res.__idem && status < 500) {
    state.idempotency.set(res.__idem.key, {
      status,
      body,
      bodyHash: res.__idem.bodyHash,
    });
  }
}

/** §2.2 — the one error shape. `details` never carries a value. */
function fail(res, status, code, message, details) {
  const body = { code, message, request_id: res.__requestId };
  if (details) body.details = details;
  const extra = (status === 429 || status === 503) ? { 'retry-after': '2' } : {};
  sendJson(res, status, body, extra);
}

/** §3.3 — an opaque cursor carrying the sort key and a filter fingerprint. */
function fingerprint(filters) {
  return createHash('sha256')
    .update(JSON.stringify(filters || {}))
    .digest('hex')
    .slice(0, 12);
}

function encodeCursor(lastId, filters) {
  return Buffer.from(JSON.stringify({ k: lastId, f: fingerprint(filters) })).toString('base64url');
}

function decodeCursor(cursor, filters) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (e) {
    return { error: 'cursor_invalid' };
  }
  if (typeof parsed.k !== 'number' || typeof parsed.f !== 'string') {
    return { error: 'cursor_invalid' };
  }
  // §3.3: changing the filter but keeping the cursor is a 400, never a silent
  // wrong answer. Silent is the hardest kind to find.
  if (parsed.f !== fingerprint(filters)) return { error: 'cursor_filter_mismatch' };
  return { key: parsed.k };
}

/** §6.3 — bearer token, revocable, carrying claim_id and issue time. */
function requireSession(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !state.sessions.has(token)) {
    fail(res, 401, 'unauthenticated', '未登录或登录凭证无效');
    return null;
  }
  if (state.revoked.has(token)) {
    fail(res, 401, 'session_revoked', '登录状态已失效，请重新登录');
    return null;
  }
  return state.sessions.get(token);
}

async function readRaw(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

function parseJson(raw) {
  if (!raw) return {};
  return JSON.parse(raw);
}

// ── Routes ─────────────────────────────────────────────────────────────────

/** §6.2 — POST /auth/session, both stages. */
function postAuthSession(res, body) {
  // §6.1 — the surface IS the role. One client, one role, fixed for the session.
  // Surfaces other than `teacher` exist here so that RBAC tests have an identity
  // to be refused with; G1 blocks parent and admin-pc in production.
  const role = ROLE_BY_SURFACE[body.surface];
  if (!role) {
    return fail(res, 422, 'validation_failed', '字段校验失败',
      { field: 'surface', rule: 'unknown_surface' });
  }
  if (!body.js_code) {
    return fail(res, 400, 'malformed_request', '缺少 js_code');
  }

  // Stage 1: code2session -> openid -> look up the current db_phone_claim.
  if (!state.openidBound) {
    if (!body.phone_code) {
      // The 409 that tells the client to reveal the phone button.
      return fail(res, 409, 'identity_binding_required', '需要验证手机号以完成首次绑定');
    }
    // Stage 2: getRealtimePhoneNumber -> normalise -> match the roster.
    // These three sentinels exist so the hard-stop UI can be exercised. F17 §二
    // offers no fallback for any of them, by design.
    if (body.phone_code === 'QUOTA') {
      return fail(res, 503, 'wechat_phone_quota_exhausted',
        '手机号验证暂时不可用，请稍后重试或联系园方');
    }
    if (body.phone_code === 'NOTONROSTER') {
      return fail(res, 403, 'identity_not_on_roster', '该手机号不在园所名册内');
    }
    if (body.phone_code === 'CONFLICT') {
      return fail(res, 409, 'identity_binding_conflict', '该手机号已绑定其他微信');
    }
    state.openidBound = true;
  }

  const token = randomUUID();
  state.sessions.set(token, { claim_id: 41, issued_at: Date.now(), role, surface: body.surface });
  return sendJson(res, 200, {
    session_token: token,
    expires_at: '2026-08-21T22:00:00+08:00',
  });
}

/** §6.4 — the whole downstream context in one call. */
function getAuthSession(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  sendJson(res, 200, {
    surface: session.surface,
    role: session.role,
    subject: TEACHER,
    scope: SCOPE,
    permissions: [],
    current_term: OPTS.noTerm ? null : TERM,
    expires_at: '2026-08-21T22:00:00+08:00',
  });
}

/**
 * §6.3 — logout. Revocation is real here rather than a generated 204, because
 * "a revoked token still works" is precisely the bug the revocation list exists
 * to prevent, and a generated route would report green while proving nothing.
 */
function deleteAuthSession(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !state.sessions.has(token)) {
    return fail(res, 401, 'unauthenticated', '未登录或登录凭证无效');
  }
  state.revoked.add(token);
  return sendJson(res, 204, null);
}

/** §3.1 — a cursor-paginated time stream. */
function getNotices(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  // No filters on this endpoint yet, but the fingerprint is computed over
  // whatever the filter set is, so adding one later cannot silently break
  // in-flight cursors.
  const filters = {};
  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = NOTICES.findIndex((n) => n.notice_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = NOTICES.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < NOTICES.length;

  // §2.1: one cursor envelope. No total — §3.1 explains that a count would need
  // a separate scan and would disagree with the pages actually walked.
  sendJson(res, 200, {
    items: slice,
    next_cursor: hasMore && last ? encodeCursor(last.notice_id, filters) : null,
  });
}

function getNotice(req, res, id) {
  if (!requireSession(req, res)) return;
  const notice = NOTICES.find((n) => n.notice_id === Number(id));
  // §2.3: absent and out-of-scope are the same 404. Returning 403 would confirm
  // the id exists, which is a leak — and worse for minors' data.
  if (!notice) return fail(res, 404, 'not_found', '通知不存在或不在可见范围内');
  sendJson(res, 200, notice);
}

/**
 * §3.1 — 党建学习列表。
 *
 * 契约 §4 规则 19 说这个集合**不搜索、不筛选**，所以筛选集恒为空，端点不收
 * `study_type`。指纹仍然算在这个空集合上：将来真加了筛选，在飞的旧游标会当场失效，
 * 而不是悄悄给出错答案（§3.3）。
 */
function getPartyStudies(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const filters = {};
  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = PARTY_STUDIES.findIndex((s) => s.study_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = PARTY_STUDIES.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < PARTY_STUDIES.length;
  sendJson(res, 200, {
    items: slice.map(toStudyCard),
    next_cursor: hasMore && last ? encodeCursor(last.study_id, filters) : null,
  });
}

function getPartyStudy(req, res, id) {
  if (!requireSession(req, res)) return;
  const study = PARTY_STUDIES.find((s) => s.study_id === Number(id));
  // §2.3: 不存在与不在可见范围内是同一个 404。回 403 会确认这个 id 存在。
  if (!study) return fail(res, 404, 'not_found', '学习资料不存在或不在可见范围内');
  sendJson(res, 200, study);
}

/** §3.5 — roster-shaped: whole, unpaginated. */
function getTodos(req, res) {
  if (!requireSession(req, res)) return;
  sendJson(res, 200, { items: TODOS });
}

/** §3.5 — the curated shelf is three rows by definition; it never pages. */
function getHomeCases(req, res) {
  if (!requireSession(req, res)) return;
  sendJson(res, 200, { items: HOME_CASES });
}

/**
 * §3.1 — 任务看板。游标分页，并带一个真实的筛选条件（`scope`），因为票据 10 要求
 * 「游标与筛选绑定，筛选变化时丢弃旧游标」——没有筛选就验证不了这条。
 *
 *   scope=current  未完成（assign_status a1/a2）
 *   scope=history  已完成（a3）
 *   缺省           全部
 */
function getTasks(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const scope = url.searchParams.get('scope') || '';
  if (scope && scope !== 'current' && scope !== 'history') {
    return fail(res, 422, 'validation_failed', '筛选条件不合法',
      { field: 'scope', rule: 'current_or_history' });
  }

  const filters = scope ? { scope } : {};
  const rows = TASKS.filter((t) => {
    if (scope === 'current') return t.assign.assign_status !== 'a3';
    if (scope === 'history') return t.assign.assign_status === 'a3';
    return true;
  });

  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = rows.findIndex((t) => t.task_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = rows.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < rows.length;
  sendJson(res, 200, {
    items: slice,
    next_cursor: hasMore && last ? encodeCursor(last.task_id, filters) : null,
  });
}

/**
 * GET /tasks/{task_id} — 契约里真实存在的端点。
 *
 * `assign` 只回调用者本人那一行；`progress` 由 assign 行实算（契约明确禁止使用
 * 原型里 52／12／6 那组常量）。§2.3：越出范围回 404，不回 403。
 */
function getTask(req, res, id) {
  if (!requireSession(req, res)) return;
  const task = TASKS.find((t) => t.task_id === Number(id));
  if (!task) return fail(res, 404, 'not_found', '任务不存在或不在可见范围内');

  const total = TASKS.length;
  const accepted = TASKS.filter((t) => t.assign.accepted_at !== null).length;
  const completed = TASKS.filter((t) => t.assign.assign_status === 'a3').length;

  sendJson(res, 200, {
    ...task,
    progress: {
      total_count: total,
      accepted_count: accepted,
      completed_count: completed,
      completion_rate: total === 0 ? 0 : Number((completed / total).toFixed(4)),
    },
    file_refs: [
      { file_id: 9001, usage_key: 'main_file', file_name: '班级实践照片打包.zip', file_size: 2483712 },
      { file_id: 9002, usage_key: 'attachment', file_name: '教师转化说明.docx', file_size: 38214 },
    ],
  });
}

/**
 * Roles for the hand-written routes, so the primitive covers them too.
 *
 * This table exists because the primitive was NOT covering them: until it was
 * added, GET /tasks/{task_id} answered 200 to a parent session. The handler
 * called requireSession and stopped there, which authenticates without
 * authorizing. That is the §7.2 failure mode written down in HANDOFF.md — a
 * rule repeated per endpoint until one endpoint forgets — and the answer is the
 * same one the contract gives: decide in one place, for every route.
 *
 * The first six entries are paths the CONTRACT DOES NOT DEFINE. The client
 * calls them and db_notification / db_home_case / db_task exist to back them,
 * but no operation was ever enumerated. They are declared teacher-only here so
 * the gate is not silently absent; the gap itself is a separate problem, filed
 * in HANDOFF.md → 契约缺口.
 */
const HAND_WRITTEN_ROLES = [
  [/^\/notices$/, ['teacher']],
  [/^\/notices\/\d+$/, ['teacher']],
  [/^\/home\/todos$/, ['teacher']],
  [/^\/home\/cases$/, ['teacher']],
  [/^\/tasks$/, ['teacher']],
  [/^\/parent-tasks$/, ['teacher']],
  [/^\/parent-tasks\/\d+\/progress$/, ['teacher']],
  // Declared by the contract; repeated here because the handler is hand-written.
  [/^\/tasks\/\d+$/, ['teacher']],
  [/^\/party\/studies$/, ['teacher']],
  [/^\/party\/studies\/\d+$/, ['teacher']],
  [/^\/auth\/session$/, ['teacher', 'parent', 'admin-pc', 'partner-account']],
];

/**
 * The one gate every request passes, before any handler runs.
 *
 * POST /auth/session is the single exception, because it is where identity is
 * created; it is `security: []` in the contract for the same reason.
 *
 * @returns {boolean} true when the request was refused and already answered
 */
function refuseUnauthorized(req, res, path) {
  if (req.method === 'POST' && path === '/auth/session') return false;

  const entry = HAND_WRITTEN_ROLES.find(([re]) => re.test(path));
  if (!entry) return false;          // contract routes gate themselves below

  const session = requireSession(req, res);
  if (!session) return true;         // 401 already sent

  const denial = authorizeRole(session, entry[1]);
  if (denial) {
    fail(res, denial.status, denial.code, denial.message);
    return true;
  }
  return false;
}

/**
 * Everything the contract declares and no hand-written handler covers.
 *
 * Order matters and is the contract's, not convenience:
 *   1. no route matches         -> false, the caller answers 404 unknown endpoint
 *   2. the route is pre-session -> serve it (only POST /auth/session is)
 *   3. no valid session         -> 401
 *   4. role not in x-hualong-roles -> 404, never 403 (§2.3)
 *   5. otherwise                -> the declared success code and a shaped body
 *
 * Step 4 must come after step 3, or an anonymous caller would get a 404 that
 * says "no such endpoint" when the truth is "you are not logged in". Those two
 * answers must stay distinguishable to the developer even though 404 is
 * deliberately ambiguous between "absent" and "out of scope".
 *
 * @returns {Promise<boolean>} true when this function answered the request
 */
async function serveFromContract(req, res, path) {
  const { routes } = await loadRoutes();
  const route = routes.find((r) => r.method === req.method && r.regex.test(path));
  if (!route) return false;

  if (!route.isPublic) {
    const session = requireSession(req, res);
    if (!session) return true;                       // 401 already sent
    let denial;
    try {
      denial = authorizeRole(session, route.roles);
    } catch (err) {
      if (err instanceof RoleResolutionError) {
        // §7.2: fatal, never an empty rule set. 500 is honest here — the server
        // cannot decide, and deciding "allow" would be the bug this prevents.
        fail(res, 500, 'internal_error', '服务出错');
        return true;
      }
      throw err;
    }
    if (denial) {
      fail(res, denial.status, denial.code, denial.message);
      return true;
    }
  }

  sendJson(res, route.status, route.body);
  return true;
}

// ── Dispatch ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  res.__requestId = req.headers['x-request-id'] || `mock-${randomUUID().slice(0, 8)}`;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, null);
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null;

  if (path === null) {
    fail(res, 404, 'not_found', `未知路径，API 基址为 ${BASE}`);
    rlog(`  ${req.method} ${url.pathname} -> ${res.statusCode}`);
    return;
  }

  try {
    // The body is read once, here, because §4's replay check needs to hash it
    // before any handler consumes the stream.
    const needsBody = req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT';
    const raw = needsBody ? await readRaw(req) : '';

    const idemKey = req.headers['idempotency-key'];
    if (idemKey && req.method === 'POST') {
      const seen = state.idempotency.get(idemKey);
      if (seen) {
        const hash = createHash('sha256').update(raw || '{}').digest('hex');
        if (hash !== seen.bodyHash) {
          // §4.3: same key, different body is almost always a client bug. Saying
          // so beats silently replaying the first result.
          fail(res, 422, 'idempotency_key_reused', '同一幂等键收到了不同的请求体');
          rlog(`  ${req.method} ${url.pathname} -> 422 (idempotency replay mismatch)`);
          return;
        }
        // §4.2: replay returns the original status and body, no side effects.
        sendJson(res, seen.status, seen.body);
        rlog(`  ${req.method} ${url.pathname} -> ${seen.status} (idempotent replay)`);
        return;
      }
      // First use of this key: mark the response so sendJson records the outcome.
      res.__idem = {
        key: idemKey,
        bodyHash: createHash('sha256').update(raw || '{}').digest('hex'),
      };
    }

    let body = {};
    if (needsBody) {
      try {
        body = parseJson(raw);
      } catch (e) {
        fail(res, 400, 'malformed_request', '请求体不是合法 JSON');
        rlog(`  ${req.method} ${url.pathname} -> 400`);
        return;
      }
    }

    if (refuseUnauthorized(req, res, path)) {
      rlog(`  ${req.method} ${url.pathname} -> ${res.statusCode}`);
      return;
    }

    if (req.method === 'POST' && path === '/auth/session') {
      postAuthSession(res, body);
    } else if (req.method === 'GET' && path === '/auth/session') {
      getAuthSession(req, res);
    } else if (req.method === 'DELETE' && path === '/auth/session') {
      deleteAuthSession(req, res);
    } else if (req.method === 'GET' && path === '/notices') {
      getNotices(req, res, url);
    } else if (req.method === 'GET' && /^\/notices\/\d+$/.test(path)) {
      getNotice(req, res, path.split('/')[2]);
    } else if (req.method === 'GET' && path === '/home/todos') {
      getTodos(req, res);
    } else if (req.method === 'GET' && path === '/home/cases') {
      getHomeCases(req, res);
    } else if (req.method === 'GET' && path === '/tasks') {
      getTasks(req, res, url);
    } else if (req.method === 'GET' && /^\/tasks\/\d+$/.test(path)) {
      getTask(req, res, path.split('/')[2]);
    } else if (req.method === 'GET' && path === '/party/studies') {
      getPartyStudies(req, res, url);
    } else if (req.method === 'GET' && /^\/party\/studies\/\d+$/.test(path)) {
      getPartyStudy(req, res, path.split('/')[3]);
    } else if (req.method === 'POST' && path === '/parent-tasks') {
      postParentTask(req, res, body);
    } else if (req.method === 'GET' && /^\/parent-tasks\/\d+\/progress$/.test(path)) {
      getParentTaskProgress(req, res);
    } else if (!await serveFromContract(req, res, path)) {
      fail(res, 404, 'not_found', `未实现的端点：${req.method} ${path}`);
    }
  } catch (err) {
    // §2.4: internal_error's message must not carry a stack or SQL.
    console.error('  mock handler threw:', err);
    if (!res.headersSent) fail(res, 500, 'internal_error', '服务出错');
  }

  rlog(`  ${req.method} ${url.pathname} -> ${res.statusCode}`);
});

/**
 * Programmatic start, for the test seam. One call per process — the module
 * holds a single server instance.
 *
 * @param {object}  [o]
 * @param {number}  [o.port=0]      0 = an OS-assigned free port, so parallel
 *                                  test processes never collide
 * @param {boolean} [o.unbound]     start with no openid bound (stage-2 flow)
 * @param {boolean} [o.noTerm]      current_term = null (holiday)
 * @param {boolean} [o.quiet=true]  suppress per-request logging
 * @returns {Promise<{port:number, baseUrl:string, close:() => Promise<void>}>}
 */
export function start({ port = 0, unbound = false, noTerm = false, quiet = true } = {}) {
  OPTS.startUnbound = unbound;
  OPTS.noTerm = noTerm;
  runtime.quiet = quiet;
  state.openidBound = !unbound;
  state.sessions.clear();
  state.revoked.clear();
  state.idempotency.clear();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        baseUrl: `http://127.0.0.1:${actual}${BASE}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// §1.2 — the exact wire format for a client-submitted scheduled time. The
// offset is a LITERAL: `Z` or any other offset is a 422 with no conversion.
const WIRE_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;

/**
 * POST /parent-tasks — the write endpoint the contract-regression tests need:
 * a scheduled-time whitelist member (db_parent_task.start_at / due_at) plus
 * the derived-tier rule made observable.
 */
function postParentTask(req, res, body) {
  if (!requireSession(req, res)) return;
  if (!body.task_title) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'task_title', rule: 'required' });
  }
  // §1.2: whitelisted scheduled times must carry +08:00 exactly.
  for (const field of ['start_at', 'due_at']) {
    if (body[field] !== undefined && !WIRE_AT.test(body[field])) {
      return fail(res, 422, 'timestamp_not_accepted', '时间格式不被接受',
        { field, rule: 'offset_must_be_plus0800_literal' });
    }
  }
  // §7.3: derived columns are server-set; a submitted value is silently
  // ignored, never echoed. The response proves the server's own value won.
  const task = {
    parent_task_id: state.nextTaskId++,
    task_title: body.task_title,
    start_at: body.start_at || null,
    due_at: body.due_at || null,
    teacher_id: TEACHER.teacher_id,   // always the session's teacher, never the body's
    class_id: SCOPE.class_id,
  };
  return sendJson(res, 201, task);
}

/** GET /parent-tasks/:id/progress — §3.5 roster shape: whole, child_id ASC. */
function getParentTaskProgress(req, res) {
  if (!requireSession(req, res)) return;
  return sendJson(res, 200, { items: ROSTER });
}

/**
 * Test hook: flip the term live, so "the term resumes and the same page's
 * write entries come back WITHOUT a re-login" is testable against the real
 * service instead of hand-assembled state.
 */
export function setNoTerm(value) {
  OPTS.noTerm = Boolean(value);
}

// CLI behaviour, unchanged: `node mock/server.mjs [--unbound] [--no-term]`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start({
    port: PORT,
    unbound: OPTS.startUnbound,
    noTerm: OPTS.noTerm,
    quiet: false,
  }).then(({ port }) => {
    console.log(`Hualong mock API  ->  http://localhost:${port}${BASE}`);
    console.log(`  openid bound at start : ${state.openidBound}`);
    console.log(`  current_term          : ${OPTS.noTerm ? 'null (holiday)' : TERM.term_id}`);
    console.log('');
    console.log('  Send these as phone_code to exercise the login failure branches:');
    console.log('    QUOTA        -> 503 wechat_phone_quota_exhausted');
    console.log('    NOTONROSTER  -> 403 identity_not_on_roster');
    console.log('    CONFLICT     -> 409 identity_binding_conflict');
  });
}
