const session = require('./utils/session');
const auth = require('./utils/auth');
const { ApiError } = require('./utils/errors');

App({
  globalData: {
    // Set once at launch so pages can lay out under the status bar without each
    // calling wx.getSystemInfo.
    safeAreaTop: 0,
    safeAreaBottom: 0,
  },

  onLaunch() {
    this.measureSafeArea();
  },

  /**
   * Re-read the session context on resume.
   *
   * Two things can change while the app sits in the background: `current_term`
   * can roll over (§6.4 allows null during a holiday), and the subject can be
   * suspended or transferred, which revokes every session in the same
   * transaction (§6.3). Discovering that on resume beats discovering it on the
   * user's first write.
   */
  onShow() {
    if (!session.isLoggedIn()) return;
    auth.refreshContext().catch((err) => {
      if (err instanceof ApiError && err.isAuthFailure) {
        session.clear();
        wx.reLaunch({ url: '/pages/login/index' });
      }
      // Any other failure is transient. F17 §二 is explicit: an established,
      // still-valid session is not logged out over a brief upstream fault.
    });
  },

  measureSafeArea() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const safeArea = info.safeArea || {};
      this.globalData.safeAreaTop = info.statusBarHeight || 0;
      this.globalData.safeAreaBottom = Math.max(
        0,
        (info.screenHeight || 0) - (safeArea.bottom || info.screenHeight || 0)
      );
    } catch (e) {
      /* defaults of 0 are fine */
    }
  },
});
