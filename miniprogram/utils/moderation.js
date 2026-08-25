/**
 * The content-safety gate (内容安全闸门).
 *
 * READ THIS BEFORE WIRING ANY UGC WRITE.
 *
 * ── The authority ─────────────────────────────────────────────────────────────
 *
 * Platform repo, **ADR-0016 (Accepted, 2026-08-23)**, which **supersedes
 * ADR-0005**. It also settles the conflict this file used to describe as open:
 * ADR-0005 required every piece of UGC to pass the WeChat call before becoming
 * visible; the backend's F17 replaced that for staff-published content with
 * 完整预览＋明确发布. ADR-0016 narrows ADR-0005 rather than overruling F17, and
 * assigns **one declared gate path per content class**. The question is closed;
 * do not re-report it as open.
 *
 * ADR-0016's table, transcribed — it is the authority, not any count of it:
 *
 *   教职工文字            使用条款同意 ＋ 完整预览 ＋ 明确发布。不送微信接口。
 *                        法律责任仍在园所（运营规范 10.4），使用条款不能转移它。
 *   **所有上传图片（含教职工）**  服务端 `security.mediaCheckAsync`，**先发后审**。
 *   家长图文              F12／F15 的微信接口阻断批次（失败关闭，通过前不可见）。
 *   资源与案例            F6 的管理端人工审核队列。
 *   视频与音频            v1 任何 UGC 路径都不收（G41 BLOCKER；DO-NOT-BUILD 12）。
 *
 * 先发后审 means: the item is visible at once and the check runs after.
 * `risky`／`review`／`error` **和 30 分钟回调超时**都算不通过；前三者自动撤回并
 * 通知作者，超时保持已发布但事件进入管理端可读队列。**教师端因此没有「审核中」
 * 中间态**（D1／D2）——所以图片这条路径上，客户端不得把内容呈现为待审。
 *
 * ── The invariant this module enforces ────────────────────────────────────────
 *
 * ADR-0016 changed its shape. Old: "每个 UGC 写入页引用内容安全接口名"。
 * New: **「每个 UGC 写入页显式声明它走哪条把关路径」**，仍为阻断级。一次写入可能
 * 同时携带两类内容（教师写的图文＝文字一条＋图片一条），所以 `assertGate` 收一个
 * 数组：声明必须覆盖本次写入携带的每一类内容，覆盖不全等同未声明。
 *
 * ── What this module is not ───────────────────────────────────────────────────
 *
 * It never calls `security.msgSecCheck` or `security.mediaCheckAsync` itself.
 * Those are server-side APIs requiring the AppSecret (DO-NOT-BUILD 13), and
 * ADR-0016 keeps the gate on the server precisely so the client cannot be the
 * boundary — 「客户端页面引用接口名」测的是一个字符串，不是行为。The client's job
 * is to **declare** the path and to honour the discipline that declaration
 * implies.
 */

const GATES = Object.freeze({
  /**
   * ADR-0016 行 1 — 教职工自己发布的文字。
   * The gate is: the author has seen the FINAL rendered content in full, and has
   * then taken a separate, deliberate publish action. Preview is not a courtesy
   * here, it is the control. `requireHumanGate` enforces it.
   * Covers: 教师寄语, 月度评价, 学期评价, 任务材料, teacher literals.
   *
   * 使用条款文本目前**还不存在**（ADR-0016 Consequences）。它必须在第一个教职工
   * 写入上线前存在并可追溯到同意记录，否则这条路径没有地基。那是上线前置，不是
   * 客户端能补的东西。
   */
  HUMAN_PREVIEW_CONFIRM: 'human_preview_confirm',

  /**
   * ADR-0016 行 2 — **所有上传图片，包括教职工上传的**。
   * 服务端 `security.mediaCheckAsync`，先发后审：内容立即可见，检查随后跑。
   * 客户端在这条路径上的义务只有一条，而且是**否定**的：不得呈现「审核中」。
   * 教师看到的就是已发布；撤回发生时由通知告知（D2）。
   *
   * 这条比 F17 严 —— F17 不送教职工内容，本决定送全部上传图片。
   */
  IMAGE_MEDIA_CHECK_ASYNC: 'image_media_check_async',

  /**
   * ADR-0016 行 4 / F6 — resources and cases go to the admin review queue. The
   * teacher submits, an admin decides, and rejection is terminal (no
   * resubmission of the same item). The client shows the pending state and must
   * not treat submission as publication.
   */
  ADMIN_REVIEW_QUEUE: 'admin_review_queue',

  /**
   * ADR-0016 行 3 / F12／F15 — parent text and images go through the WeChat
   * content-safety API as a blocking batch. Not reachable from the teacher
   * client; present so the enumeration matches the contract and so a misrouted
   * call fails loudly.
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
 * Enforce the ADR-0016 staff human gate before a publish call.
 *
 * @param {object} state
 * @param {boolean} state.previewedInFull  the author reached the end of the
 *        final rendered content — not merely opened the preview
 * @param {boolean} state.confirmed        a separate, explicit publish tap
 * @param {string}  state.what             what is being published, for the error
 *
 * Throws rather than returning false. A publish path that can proceed while this
 * is unsatisfied is the exact failure the PRD's hard metric measures
 * (「published items outside their declared gate path = 0 (hard)」).
 */
function requireHumanGate({ previewedInFull, confirmed, what }) {
  if (!previewedInFull) {
    throw new ModerationError(
      `${what || '内容'}尚未完整预览，不能发布。完整预览是人工把关本身（ADR-0016），不是提示。`
    );
  }
  if (!confirmed) {
    throw new ModerationError(
      `${what || '内容'}缺少明确的发布确认。预览与确认必须是两个独立动作。`
    );
  }
  return true;
}

/** One declared path, and the discipline it implies on the client. */
function assertOneGate(gate, state) {
  switch (gate) {
    case GATES.HUMAN_PREVIEW_CONFIRM:
      return requireHumanGate(state);

    case GATES.IMAGE_MEDIA_CHECK_ASYNC:
      // 先发后审：图片立即可见，检查在服务端随后跑。客户端唯一能违反的，是把它
      // 说成待审 —— 教师端没有「审核中」中间态（D1／D2）。
      if (state.claimsPending) {
        throw new ModerationError(
          '图片走先发后审，教师端没有「审核中」状态，界面不得显示为待审（ADR-0016）。'
        );
      }
      return true;

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

/**
 * Declare the gate path(s) for a write and assert the discipline they imply.
 *
 * Call this immediately before the API write — **before the request leaves**, so
 * an undeclared write never reaches the network. Pass the gate, or an ARRAY of
 * gates when the write carries more than one content class.
 *
 * WHY AN ARRAY. ADR-0016's table is keyed by **content class**, not by screen. A
 * teacher's 图文 is two classes in one write: the text is the staff class
 * (完整预览＋明确发布) and every image is the image class (先发后审). Declaring one
 * gate per screen would force a choice between two paths that are both correct,
 * and whichever the screen picked, the other class would travel undeclared.
 *
 * `state.imageCount` is how a caller says "this write carries images". A write
 * that carries images and does not declare the image path is **undeclared for
 * that class**, and is refused — that is the whole invariant, applied to the half
 * of the payload it is easiest to forget.
 *
 * There is no default and there is no empty declaration: 「我忘了想把关」不得看起来
 * 像「这里不需要把关」。
 */
function assertGate(gate, state = {}) {
  const declared = Array.isArray(gate) ? gate : [gate];
  if (declared.length === 0) {
    throw new ModerationError(
      '未声明内容安全闸门。每条 UGC 写入必须显式指定 GATES 之一；收到：空声明'
    );
  }
  declared.forEach((one) => assertOneGate(one, state));

  // 声明必须覆盖本次写入携带的每一类内容。
  if (state.imageCount > 0 && declared.indexOf(GATES.IMAGE_MEDIA_CHECK_ASYNC) === -1) {
    throw new ModerationError(
      `本次写入含 ${state.imageCount} 张图片，但没有声明图片把关路径。` +
      `ADR-0016：所有上传图片（含教职工）走服务端 mediaCheckAsync 先发后审。`
    );
  }
  return true;
}

/**
 * Pending-state copy, so every surface words the wait the same way.
 *
 * The two staff paths return '' on purpose: 完整预览＋明确发布 publishes at once,
 * and 先发后审 publishes at once too. Neither has a wait to word.
 */
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
