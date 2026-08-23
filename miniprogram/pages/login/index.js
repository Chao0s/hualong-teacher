/**
 * Login — the two stages of API-CONTRACT.md §6.2.
 *
 * Stage 2's button is hidden until stage 1 returns
 * `409 identity_binding_required`, per A2's cost guidance: every rendered
 * `getRealtimePhoneNumber` tap is a billed call against a capped quota.
 */

const auth = require('../../utils/auth');
const session = require('../../utils/session');
const { ApiError } = require('../../utils/errors');

Page({
  data: {
    phase: 'checking',   // checking | signing | needs_phone | blocked
    jsCode: '',
    errorText: '',
    errorRequestId: '',
    // A hard stop (F17 §二): quota exhausted or upstream down. There is
    // deliberately no fallback path to offer, so the UI says so plainly.
    hardStop: false,
  },

  onLoad() {
    if (session.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/home/index' });
      return;
    }
    this.startSignIn();
  },

  /** Stage 1. Silent — no user interaction needed when the openid is bound. */
  async startSignIn() {
    this.setData({ phase: 'signing', errorText: '', errorRequestId: '', hardStop: false });
    try {
      const result = await auth.signIn();
      if (result.status === 'ok') {
        wx.reLaunch({ url: '/pages/home/index' });
        return;
      }
      // Not bound yet: reveal the phone button and keep the js_code for stage 2.
      this.setData({ phase: 'needs_phone', jsCode: result.jsCode });
    } catch (err) {
      this.showFailure(err);
    }
  },

  /**
   * Stage 2. Bound to <button open-type="getRealtimePhoneNumber">.
   *
   * `e.detail.code` is the single-use, 5-minute phone_code. The deprecated
   * `getPhoneNumber` API must not be used (A2), and a user-typed number is never
   * accepted — the roster is the authority and the verification must be live.
   */
  async onPhone(e) {
    const detail = e.detail || {};
    if (!detail.code) {
      // The user declined the authorization sheet. Not an error state; the
      // button stays available.
      this.setData({ errorText: '需要验证手机号才能登录，请点击授权。' });
      return;
    }

    this.setData({ phase: 'signing', errorText: '', errorRequestId: '' });
    try {
      await auth.bindPhone(this.data.jsCode, detail.code);
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (err) {
      // js_code is single-use and expires in 5 minutes. If it went stale while
      // the user was reading the authorization sheet, get a fresh one rather
      // than showing an error the user cannot act on.
      if (err instanceof ApiError && err.code === 'validation_failed') {
        this.startSignIn();
        return;
      }
      this.showFailure(err);
    }
  },

  showFailure(err) {
    const isApi = err instanceof ApiError;
    const code = isApi ? err.code : '';

    // These three are terminal for the user: nothing they can do in-app fixes
    // them, and F17 §二 forbids offering a bypass.
    const hardStop = code === 'wechat_phone_quota_exhausted'
      || code === 'identity_not_on_roster'
      || code === 'identity_binding_conflict';

    this.setData({
      phase: hardStop ? 'blocked' : 'needs_phone',
      hardStop,
      errorText: isApi ? err.userMessage : '登录失败，请稍后重试',
      errorRequestId: isApi ? (err.requestId || '') : '',
    });
  },

  onRetry() {
    this.startSignIn();
  },
});
