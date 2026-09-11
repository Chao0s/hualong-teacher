/**
 * 登录 —— API-CONTRACT.md §6.2，两段式。权威实作在 utils/auth.js，本页只调它：
 * 不拼 URL、不 require utils/request、不自己译错误码（§2.2／§4）。
 *
 *   stage 1  进页就静默走：wx.login -> js_code -> POST /auth/session { surface, js_code }
 *            已绑定  -> 200，签票，本页跳首页
 *            未绑定  -> 409 identity_binding_required，本页亮出手机号按钮
 *   stage 2  前端补 phone_code 重发同一条。**今天没接** —— 见 onGetPhoneNumber()。
 *
 * ── 为什么调 auth.signIn() 而不是 auth.ensureSession() ───────────────────────
 * ensureSession() 只把 context 交出来。409 那一支根本没有 context，于是它会 resolve 成
 * undefined —— 页面看不出「需要补手机号」，会把它当成登录成功。signIn() 把
 * 「已登录」与「需要手机号」当成两个返回值交回来，正是这一页要的那两件事。
 *
 * ── 跳首页为什么是 reLaunch，不是 switchTab ───────────────────────────────────
 * app.json 里没有 `tabBar` 键，底部导航是 components/hl-tabbar（原生 tabBar 只收 PNG
 * 图标，本工程是 SVG，理由见 utils/guard.js 头注）。对非 tab 页调 wx.switchTab 会**静默
 * 失败**：什么都不发生，也不报错。hl-tabbar 自己切页用的就是 reLaunch
 * （components/hl-tabbar/index.js:40），本页与它一致。
 *
 * ── 进页先读一次 session.isLoggedIn() ────────────────────────────────────────
 * 已经有活会话就不再打一次登录。这张票只用来**省一次往返**，不用来当权限：会话是不是
 * 还活着以服务端为准（§6.3），所以它说「已登录」也只是省掉这一发。
 */

const auth = require('../../utils/auth');
const session = require('../../utils/session');

const HOME = '/pages/home/index';

/**
 * 手机号那一步今天为什么走不通 —— 写在页面上给教师看的那一句。
 *
 * 后端 G1：`db_phone_claim.ck_pc2_type` 今天只允许 c1（正式教师）与 c5（合作园帐户），
 * `db_parent`／`db_admin` 也没有 openid 列，所以契约把 createSession 的
 * `x-hualong-blocked-on` 记成「G1（仅 surface=parent 与管理端 PC；teacher 可实作）」。
 * 绑定这条线按契约也只能走 `getRealtimePhoneNumber` 的真机动态令牌，客户端不自己拼。
 */
const PHONE_NOTE = '手机号验证这一段今天还没接通（等后端把缺口 G1 落地）。按钮点得下去，但走不通：它不会假装验证成功，也不提供短信、邀请码、人工绑定或密码后门 —— 那四条都是绕过唯一一道身份闸门的侧门。';

/**
 * 配额耗尽（503 wechat_phone_quota_exhausted）是**安全阻断**，不是普通失败。
 *
 * 契约 F17 的原话：不提供短信、邀请码、人工绑定，也没有密码后门。所以这一支只给一句
 * 解释，绝不加一条替代路径的代码（DO-NOT-BUILD 10）。
 */
const QUOTA_STOP_NOTE = '手机号验证配额已用尽，这是服务端的安全阻断（契约 F17）。系统不提供短信验证、邀请码、人工绑定，也没有密码后门，今天无法完成首次登录。请稍后重试，或让园方处理。';

Page({
  data: {
    // 正在静默走 stage 1
    loading: true,
    // 只有 stage 1 回了 409 identity_binding_required 才为真 —— 手机号按钮因此才出现
    needsPhone: false,
    // 失败主文案。取自 err.userMessage（utils/errors.js 的 §2.4 登记表）
    failed: '',
    // 失败是不是那条 503 安全阻断
    quotaStop: false,
    quotaStopNote: QUOTA_STOP_NOTE,
    phoneNote: PHONE_NOTE,
  },

  onLoad() {
    if (session.isLoggedIn()) {
      this.goHome();
      return;
    }
    this.signIn();
  },

  /** stage 1。三个出口：跳首页／亮手机号按钮／显示失败。 */
  async signIn() {
    this.setData({ loading: true, needsPhone: false, failed: '', quotaStop: false });
    try {
      const result = await auth.signIn();
      if (result.status === 'needs_phone') {
        // 409 identity_binding_required。auth.signIn() 把 js_code 一并交回来，
        // 因为 js_code 只能用一次：stage 2 要复用它，而不是重新 wx.login。
        // 今天 stage 2 没接，这个 jsCode 先留在实例上，接的时候直接用它（见 onGetPhoneNumber）。
        this.jsCode = result.jsCode;
        this.setData({ loading: false, needsPhone: true });
        return;
      }
      this.goHome();
    } catch (err) {
      // §2.2：客户端按 code 分支，不得字符串匹配 message。枚举本身留在 utils/errors.js，
      // 这里只挑出「配额耗尽」这一支，好把 F17 那句说明补上；其余一律用 err.userMessage。
      const quotaStop = Boolean(err) && err.code === 'wechat_phone_quota_exhausted';
      this.setData({
        loading: false,
        needsPhone: false,
        failed: (err && err.userMessage) || (err && err.message) || '登录没有完成，请稍后重试',
        quotaStop,
      });
    }
  },

  goHome() {
    wx.reLaunch({ url: HOME });
  },

  onRetry() {
    this.signIn();
  },

  /**
   * stage 2 —— **今天留空**，不接。按钮可点，点了照实说，不编一个假成功。
   *
   * 这里**故意不调 auth.bindPhone()**：后端 G1 没落地，绑定这条线在服务端实作不出来，
   * 调了也是发一条必然失败或必然不落库的请求。等 G1 落地后，这个方法的正文换成下面三行，
   * 并按 auth.js 头注里登记的三条错误分别给文案：
   *
   *   const res = await auth.bindPhone(this.jsCode, e.detail.code);   // e.detail.code 是
   *                                                                  // 动态令牌，5 分钟、一次
   *   if (res.status === 'ok') this.goHome();
   *   // 403 identity_not_on_roster     手机号不在名册上，无自助注册（A3）
   *   // 409 identity_binding_conflict  同号异名，或该 claim 已绑过别的微信
   *   // 503 wechat_phone_quota_exhausted  配额耗尽，安全阻断（F17）
   *   // js_code 过期时重新走一次 this.signIn() 换新的 —— js_code 只能用一次。
   *
   * 注意 e.detail.code 只可能是真机点出来的动态令牌，**不收用户手输的手机号**（A2）。
   */
  onGetPhoneNumber(e) {
    const phoneCode = e && e.detail && e.detail.code;
    if (!phoneCode) {
      // 用户点了取消，或者这次没拿到动态令牌 —— 都不是成功。
      wx.showToast({ title: '还没拿到手机号验证凭证', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '这一步还没接通',
      content: PHONE_NOTE,
      showCancel: false,
      confirmText: '知道了',
    });
  },
});
