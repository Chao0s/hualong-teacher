/**
 * Login — the two stages of API-CONTRACT.md §6.2, rendered.
 *
 * This page is the service-layer template (ticket 05): it calls
 * services/identity, setDatas what comes back, and reacts to taps. It holds
 * no network call and no error-code knowledge — failure classification lives
 * in the service, and the page only renders the classification's `kind`.
 *
 * Stage 2's button stays hidden until stage 1 says needs_phone, per A2's cost
 * guidance: every rendered getRealtimePhoneNumber tap is a billed call
 * against a capped quota.
 */

const identity = require('../../services/identity');

Page({
  data: {
    phase: 'checking',   // checking | signing | needs_phone | blocked
    jsCode: '',
    errorText: '',
    errorRequestId: '',
    // A hard stop (F17 §二): nothing the user does in-app fixes it, and there
    // is deliberately no fallback to offer, so the UI says so plainly.
    hardStop: false,
  },

  onLoad() {
    if (identity.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/home/index' });
      return;
    }
    this.startSignIn();
  },

  /** Stage 1. Silent — no user interaction when the openid is bound. */
  async startSignIn() {
    this.setData({ phase: 'signing', errorText: '', errorRequestId: '', hardStop: false });
    try {
      const result = await identity.signIn();
      if (result.status === 'ok') {
        wx.reLaunch({ url: '/pages/home/index' });
        return;
      }
      this.setData({ phase: 'needs_phone', jsCode: result.jsCode });
    } catch (err) {
      this.showFailure(err);
    }
  },

  /** Stage 2. Bound to <button open-type="getRealtimePhoneNumber">. */
  async onPhone(e) {
    const detail = e.detail || {};
    if (!detail.code) {
      // The user declined the authorization sheet. Not an error state.
      this.setData({ errorText: '需要验证手机号才能登录，请点击授权。' });
      return;
    }

    this.setData({ phase: 'signing', errorText: '', errorRequestId: '' });
    try {
      await identity.bindPhone(this.data.jsCode, detail.code);
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (err) {
      this.showFailure(err);
    }
  },

  showFailure(err) {
    const failure = identity.classifyFailure(err);
    if (failure.kind === 'stale-code') {
      // The js_code went stale while the user read the sheet. Restart stage 1
      // rather than showing an error the user cannot act on.
      this.startSignIn();
      return;
    }
    this.setData({
      phase: failure.kind === 'hard-stop' ? 'blocked' : 'needs_phone',
      hardStop: failure.kind === 'hard-stop',
      errorText: failure.message,
      errorRequestId: failure.requestId,
    });
  },

  onRetry() {
    this.startSignIn();
  },
});
