/**
 * The single HTTP entry point. Every network call in this client goes through
 * here — API-CONTRACT.md §1 to §5 are implemented once, in this file.
 *
 * What this layer guarantees to its callers:
 *   - §1.4  Authorization / Idempotency-Key / X-Request-Id headers
 *   - §2.1  the success shape is unwrapped ({ items, next_cursor } stays intact)
 *   - §2.2  every failure arrives as an ApiError carrying a stable `code`
 *   - §3.1  cursor pagination only; `offset`/`page`/`total` do not exist
 *   - §4    idempotency keys, generated per logical attempt, not per retry
 *   - §5.1  CAS `revision` passthrough
 *   - §5.3  Retry-After is honoured
 *   - §7.3  derived keys are stripped before send
 *
 * What it deliberately does NOT do: refresh the session. A 401 raises and the
 * caller decides, because re-login involves UI (§6.2's second stage needs a real
 * user tap on a `getRealtimePhoneNumber` button) and cannot be done silently
 * from inside a request.
 */

const config = require('../config');
const { ApiError } = require('./errors');
const { stripDerived } = require('./derived');
const session = require('./session');

// §1.1: JSON in, JSON out. There is no second content type on the API instance.
const CONTENT_TYPE = 'application/json; charset=utf-8';

// Actions that must carry Idempotency-Key. api/action-registry.tsv's
// `idempotency` column is the authority; this is the subset §4.1 names outright.
// Keyed by the action_key from the registry so the two can be diffed by eye.
const IDEMPOTENT_ACTIONS = new Set([
  'school_book.setting.publish_first',      // d1 -> d2, rule 78
  'book.teacher_message.submit_class',      // rule 82
  'book.finalize',                          // b1 -> b2 with n5, rule 89
  'book_section.remind_parents',            // creates n4, rule 99
  'org.child.transfer_class',               // n5 fan-out, rule 58
  'content_check.submit_all',               // rule 33 (parent surface)
]);

let requestSeq = 0;

/** Enough entropy for a UUIDv4-equivalent per §4.2, without a crypto dep. */
function uuid() {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    if (i === 12) {
      out += '4';
    } else if (i === 16) {
      out += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
    } else {
      out += hex[Math.floor(Math.random() * 16)];
    }
  }
  return (
    `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-` +
    `${out.slice(16, 20)}-${out.slice(20)}`
  );
}

/** Client-side request id, so a failure is traceable even if the call never lands. */
function nextRequestId() {
  requestSeq += 1;
  return `mp-t-${Date.now().toString(36)}-${requestSeq}`;
}

function buildQuery(params) {
  if (!params) return '';
  const parts = [];
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      // Repeated key, which is what openapi.yaml's array params declare.
      value.forEach((v) => parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`));
      return;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return parts.length ? `?${parts.join('&')}` : '';
}

function headerValue(headers, name) {
  if (!headers) return null;
  const lower = String(name).toLowerCase();
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === lower);
  return hit ? headers[hit] : null;
}

function toApiError(statusCode, body, headers) {
  const payload = body && typeof body === 'object' ? body : {};
  const retryAfterRaw = headerValue(headers, 'Retry-After');
  return new ApiError({
    statusCode,
    code: payload.code,
    message: payload.message,
    // §2.2: the body's request_id equals the X-Request-Id header. Prefer the
    // body, fall back to the header, so a gateway-level failure is still traceable.
    requestId: payload.request_id || headerValue(headers, 'X-Request-Id'),
    details: payload.details,
    retryAfter: retryAfterRaw ? Number(retryAfterRaw) : null,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One wire attempt. No retry logic, no idempotency-key generation — the caller
 * owns both, because a retry must reuse the SAME key (§4.2) and a fresh logical
 * attempt must use a new one.
 */
function attempt({ method, url, header, data }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      header,
      data,
      // The Mini Program parses JSON responses itself when the content type
      // says so; keeping dataType default avoids double-parsing.
      timeout: 20000,
      success: (res) => resolve(res),
      fail: (err) => {
        // Transport-level failure: no HTTP status at all. Not an ApiError from
        // the contract's registry, so it gets the shape of one without pretending
        // to a code the server never sent.
        reject(new ApiError({
          statusCode: 0,
          code: 'upstream_unavailable',
          message: (err && err.errMsg) ? `网络请求失败：${err.errMsg}` : '网络请求失败',
        }));
      },
    });
  });
}

/**
 * Core request.
 *
 * @param {string}  method       GET/POST/PATCH/PUT/DELETE
 * @param {string}  path         path under the base url, e.g. '/notices'
 * @param {object}  [opts.query] query params (§3: limit/cursor, filters)
 * @param {object}  [opts.body]  request body; derived keys are stripped
 * @param {string}  [opts.idempotencyKey] reuse across retries of one attempt
 * @param {string}  [opts.action] action_key; supplies the key automatically when
 *                                §4.1 requires one
 * @param {number}  [opts.revision] CAS value for the three columns in §5.1
 * @param {boolean} [opts.anonymous] skip Authorization (only POST /auth/session)
 */
async function request(method, path, opts = {}) {
  if (!config.env.baseUrl) {
    throw new ApiError({
      statusCode: 0,
      code: 'upstream_unavailable',
      message: 'API 地址未配置（域名备案完成后填入 config.js）',
    });
  }

  const verb = String(method).toUpperCase();
  const url = `${config.env.baseUrl}${path}${buildQuery(opts.query)}`;

  let body = opts.body;
  if (body && (verb === 'POST' || verb === 'PATCH' || verb === 'PUT')) {
    const { body: cleaned, stripped } = stripDerived(body);
    body = cleaned;
    if (stripped.length && config.isMock) {
      // Loud in development, silent in production. A stripped key is a caller
      // bug, and §7.3's silent-ignore rule means the server will not tell you.
      console.warn(
        `[request] dropped server-owned keys before ${verb} ${path}: ${stripped.join(', ')}`
      );
    }
    if (opts.revision !== undefined && opts.revision !== null) {
      body.revision = opts.revision; // §5.1
    }
  }

  const header = { 'content-type': CONTENT_TYPE };

  if (!opts.anonymous) {
    const token = session.getToken();
    if (!token) {
      throw new ApiError({
        statusCode: 401,
        code: 'unauthenticated',
        message: '尚未登录',
      });
    }
    header.Authorization = `Bearer ${token}`;
  }

  header['X-Request-Id'] = nextRequestId();

  let idempotencyKey = opts.idempotencyKey;
  if (!idempotencyKey && verb === 'POST' && opts.action && IDEMPOTENT_ACTIONS.has(opts.action)) {
    idempotencyKey = uuid();
  }
  if (idempotencyKey) {
    header['Idempotency-Key'] = idempotencyKey;
  }

  let lastError = null;
  for (let tryIndex = 0; tryIndex <= config.maxAutoRetries; tryIndex += 1) {
    let res;
    try {
      res = await attempt({ method: verb, url, header, data: body });
    } catch (transportError) {
      lastError = transportError;
      // Only idempotent-by-HTTP-semantics verbs are safe to auto-retry when we
      // do not know whether the request landed. A POST without an idempotency
      // key could double-execute, so it is surfaced instead.
      const safe = verb === 'GET' || Boolean(idempotencyKey);
      if (safe && tryIndex < config.maxAutoRetries) {
        await sleep(400 * (tryIndex + 1));
        continue;
      }
      throw transportError;
    }

    const { statusCode, data, header: resHeaders } = res;

    if (statusCode >= 200 && statusCode < 300) {
      // §2.1: 204 has an empty body; a resource comes back at the top level and
      // a collection comes back as { items, next_cursor }. No unwrapping.
      return statusCode === 204 ? null : data;
    }

    const apiError = toApiError(statusCode, data, resHeaders);

    // ── 死会话：清掉、重新签一张、把这一发重放一次 ─────────────────────────
    //
    // 只在 devSession 环境做，理由是那里重新登录**不需要任何 UI**。生产环境
    // 保持这个模块头注写的那条约定不变：401 原样抛出，由调用方决定 —— 因为
    // §6.2 第二阶段要用户真的点一下 `getRealtimePhoneNumber` 按钮，那件事不可能
    // 从一次请求内部悄悄完成。
    //
    // 为什么非有这一段不可：契约服务端的会话表是**进程内存**
    // （`server/lib/auth.mjs`：`const SESSIONS = new Map()`，注释写明「重启即失效」），
    // 而客户端的 token 存在 `wx.setStorageSync` 里，**跨重启存活**。服务端重启一次，
    // 模拟器里那张票就成了死票，而 `session.isLoggedIn()` 只看本地有没有 token，
    // 看不出对面已经不认了。没有这一段，开发者工具里每次重启服务端后的第一批
    // 请求全是 401。
    //
    // `skipAuthRetry` 有两个来源，含义相同：**这一发不要再试着重新登录**。
    //   1. 重放本身带着它 —— 只重放一次，第二次还 401 就是真的登不上，往上抛；
    //   2. 登录过程内部的那次 `GET /auth/session` 带着它（见 utils/auth.js
    //      的 adoptSession）。少了这一条会死锁：登录中途的 401 会去 await
    //      `ensureSession()`，而那个 promise 正是当前这次登录本身 —— 它在等自己。
    //      离职教师（teacher_id 13）就会走到这条路上：`/dev/session` 照发 token，
    //      下一发请求才回 session_revoked。
    if (statusCode === 401 && config.env.devSession && !opts.skipAuthRetry) {
      session.clear();
      // 惰性 require：auth 在模块顶层就 require 了本模块，顶层互引会拿到半成品。
      const auth = require('./auth');
      await auth.ensureSession();
      return request(method, path, { ...opts, skipAuthRetry: true });
    }

    // §5.3 / §2.3: 429 and 503 always carry Retry-After and are the only
    // statuses worth waiting on. Everything else is either the caller's fault
    // (4xx) or our bug (500), and retrying changes nothing.
    const waitable = statusCode === 429 || statusCode === 503;
    if (waitable && tryIndex < config.maxAutoRetries) {
      const waitSeconds = apiError.retryAfter || (tryIndex + 1);
      // Cap the automatic wait. A long Retry-After is the server asking us to
      // stop, not to block the UI for a minute.
      if (waitSeconds <= 5) {
        lastError = apiError;
        await sleep(waitSeconds * 1000);
        continue;
      }
    }

    throw apiError;
  }

  throw lastError;
}

/**
 * Walk one page of a cursor-paginated collection (§3.1).
 *
 * Returns `{ items, nextCursor }`. `nextCursor === null` means the end. There is
 * no `total` and no page number, by design — §3.1 explains why offset paging
 * loses and duplicates rows on the insert-heavy streams this app reads most.
 */
async function getPage(path, { cursor, limit, ...filters } = {}) {
  const query = { ...filters, limit: limit || config.defaultPageLimit };
  if (cursor) query.cursor = cursor;
  const data = await request('GET', path, { query });
  return {
    items: (data && data.items) || [],
    nextCursor: (data && data.next_cursor) || null,
  };
}

/**
 * Read a roster-shaped collection whole (§3.5).
 *
 * These endpoints do not paginate: they are child-by-status tables ordered by
 * `child_id ASC`, bounded by class size, and their meaning is "this one,
 * complete". Paginating them would make "is anyone incomplete?" a client-side
 * assembly job.
 */
async function getRoster(path, filters = {}) {
  const data = await request('GET', path, { query: filters });
  return (data && data.items) || [];
}

module.exports = {
  request,
  getPage,
  getRoster,
  uuid,
  get: (path, opts) => request('GET', path, opts),
  post: (path, opts) => request('POST', path, opts),
  patch: (path, opts) => request('PATCH', path, opts),
  // PUT is the contract's verb for idempotent per-item scoring
  // (`PUT /children/{child_id}/child-assessment/items/{item_id}`, §4.1). The core
  // already treats it as body-carrying; this only exposes it.
  put: (path, opts) => request('PUT', path, opts),
  del: (path, opts) => request('DELETE', path, opts),
};
