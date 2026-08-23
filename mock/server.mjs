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
  if (body.surface !== 'teacher') {
    return fail(res, 422, 'validation_failed', '字段校验失败',
      { field: 'surface', rule: 'must_be_teacher' });
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
  state.sessions.set(token, { claim_id: 41, issued_at: Date.now() });
  return sendJson(res, 200, {
    session_token: token,
    expires_at: '2026-08-21T22:00:00+08:00',
  });
}

/** §6.4 — the whole downstream context in one call. */
function getAuthSession(req, res) {
  if (!requireSession(req, res)) return;
  sendJson(res, 200, {
    surface: 'teacher',
    role: 'teacher',
    subject: TEACHER,
    scope: SCOPE,
    permissions: [],
    current_term: OPTS.noTerm ? null : TERM,
    expires_at: '2026-08-21T22:00:00+08:00',
  });
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

/** §3.5 — roster-shaped: whole, unpaginated. */
function getTodos(req, res) {
  if (!requireSession(req, res)) return;
  sendJson(res, 200, { items: TODOS });
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

    if (req.method === 'POST' && path === '/auth/session') {
      postAuthSession(res, body);
    } else if (req.method === 'GET' && path === '/auth/session') {
      getAuthSession(req, res);
    } else if (req.method === 'GET' && path === '/notices') {
      getNotices(req, res, url);
    } else if (req.method === 'GET' && /^\/notices\/\d+$/.test(path)) {
      getNotice(req, res, path.split('/')[2]);
    } else if (req.method === 'GET' && path === '/home/todos') {
      getTodos(req, res);
    } else if (req.method === 'POST' && path === '/parent-tasks') {
      postParentTask(req, res, body);
    } else if (req.method === 'GET' && /^\/parent-tasks\/\d+\/progress$/.test(path)) {
      getParentTaskProgress(req, res);
    } else {
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
