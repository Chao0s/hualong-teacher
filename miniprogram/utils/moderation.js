/**
 * The content-safety gate (内容安全闸门).
 *
 * READ THIS BEFORE WIRING ANY UGC WRITE. There is an unresolved conflict between
 * two authorities about which gate applies to teacher-published content, and
 * this module refuses to guess.
 *
 * ── The conflict ──────────────────────────────────────────────────────────────
 *
 * Platform repo, ADR-0005 (Accepted, 2026-06-18) — still Accepted today:
 *   "All UGC passes a server-side moderation gate before it becomes visible:
 *    Text -> security.msgSecCheck. Image/video/audio -> security.mediaCheckAsync.
 *    The client must never publish UGC directly to a public collection."
 *
 * Backend repo, DECISIONS.md F17 §八 (已定, 2026-08-12) — later, and narrower:
 *   "教師／admin 自己明確發布的 literal、教師寄語、月／學期評價、任務材料及其他
 *    教師／admin UGC，完整預覽加明確發布／提交就是人工把關，成功後依 F16 鎖定；
 *    不再逐對象重複詢問是否送微信 API。家長圖文仍走已定的微信內容安全 API 阻斷
 *    流程。資源／案例維持 F6 的管理端人工審核。這是運營規範允許的
 *    「內容安全 API 或人工審核」二選一落地。"
 *
 * F17 is later and the backend treats the question as closed ("不再有『採用 API
 * 還是人工』的產品開放項"). ADR-0005 has not been superseded, and the Platform
 * repo's own structure judge still enforces "every UGC-write screen references
 * msgSecCheck or mediaCheckAsync" as a blocking invariant. Under F17 the teacher
 * screens legitimately reference neither.
 *
 * Recorded as an open question in the Platform repo's docs/GRILLING.md. Until it
 * is decided, this module makes the choice explicit at every call site instead of
 * defaulting, so no write can slip through by omission.
 *
 * ── What this module is not ───────────────────────────────────────────────────
 *
 * It never calls `security.msgSecCheck` or `security.mediaCheckAsync` itself.
 * Those are server-side APIs requiring the AppSecret, and ADR-0005 puts the gate
 * on the server precisely so the client cannot be the boundary. The client's job
 * is to (a) enforce the human-review discipline where that is the chosen gate
 * and (b) render the pending state where the server gate is the chosen one.
 */

const GATES = Object.freeze({
  /**
   * F17 §八 — teacher/admin content the author explicitly publishes.
   * The gate is: the author has seen the FINAL rendered content in full, and has
   * then taken a separate, deliberate publish action. Preview is not a courtesy
   * here, it is the control. `requireHumanGate` enforces it.
   * Covers: 教师寄语, 月度评价, 学期评价, 任务材料, teacher literals.
   */
  HUMAN_PREVIEW_CONFIRM: 'human_preview_confirm',

  /**
   * F6 — resources and cases go to the admin review queue. The teacher submits,
   * an admin decides, and rejection is terminal (no resubmission of the same
   * item). The client shows the pending state and must not treat submission as
   * publication.
   */
  ADMIN_REVIEW_QUEUE: 'admin_review_queue',

  /**
   * F12/F15 — parent text and images go through the WeChat content-safety API as
   * a blocking batch. Not reachable from the teacher client; present so the
   * enumeration matches the contract and so a misrouted call fails loudly.
   */
  WECHAT_API_BATCH: 'wechat_api_batch',
});

class ModerationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModerationError';
  }
}

/**
 * Enforce the F17 human gate before a publish call.
 *
 * @param {object} state
 * @param {boolean} state.previewedInFull  the author reached the end of the
 *        final rendered content — not merely opened the preview
 * @param {boolean} state.confirmed        a separate, explicit publish tap
 * @param {string}  state.what             what is being published, for the error
 *
 * Throws rather than returning false. A publish path that can proceed while this
 * is unsatisfied is the exact failure ADR-0005's "0 (hard)" metric measures.
 */
function requireHumanGate({ previewedInFull, confirmed, what }) {
  if (!previewedInFull) {
    throw new ModerationError(
      `${what || '内容'}尚未完整预览，不能发布。完整预览是人工把关本身（F17 §八），不是提示。`
    );
  }
  if (!confirmed) {
    throw new ModerationError(
      `${what || '内容'}缺少明确的发布确认。预览与确认必须是两个独立动作。`
    );
  }
  return true;
}

/**
 * Declare the gate for a write and assert the discipline it implies.
 *
 * Call this immediately before the API write, passing the gate the decided
 * design assigns to this object. An unknown or missing gate throws: the whole
 * point is that "I forgot to think about moderation" cannot look like "no
 * moderation was needed".
 */
function assertGate(gate, state = {}) {
  switch (gate) {
    case GATES.HUMAN_PREVIEW_CONFIRM:
      return requireHumanGate(state);

    case GATES.ADMIN_REVIEW_QUEUE:
      // Nothing to assert client-side beyond honesty in the UI: the item is
      // pending, not published, and the server holds it invisible to non-authors.
      if (state.claimsPublished) {
        throw new ModerationError(
          '提交进入审核队列不等于已发布，界面不得显示为已发布（F6）。'
        );
      }
      return true;

    case GATES.WECHAT_API_BATCH:
      throw new ModerationError(
        '微信内容安全 API 批次是家长端路径，教师端不应触达（F12／F15）。'
      );

    default:
      throw new ModerationError(
        `未声明内容安全闸门。每条 UGC 写入必须显式指定 GATES 之一；` +
        `收到：${JSON.stringify(gate)}`
      );
  }
}

/** Pending-state copy, so every surface words the wait the same way. */
function pendingLabel(gate) {
  if (gate === GATES.ADMIN_REVIEW_QUEUE) return '待审核';
  if (gate === GATES.WECHAT_API_BATCH) return '内容检查中';
  return '';
}

module.exports = {
  GATES,
  ModerationError,
  requireHumanGate,
  assertGate,
  pendingLabel,
};
