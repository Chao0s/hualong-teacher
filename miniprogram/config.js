/**
 * Build-time configuration. No secrets here — this file ships inside the client
 * package and is readable by anyone who unpacks it.
 *
 * The AppSecret and the WeChat content-safety credentials belong to the server
 * and must never appear in miniprogram/.
 */

// The surface identifier the API uses to pick which AppID's session rules apply.
// API-CONTRACT.md §6.2: POST /auth/session takes { surface, js_code }.
const SURFACE = 'teacher';

// API-CONTRACT.md §1.1: the major version lives in the path and only moves for
// breaking changes.
const ENVS = {
  // hualong-backend/db/testdata/server/server.mjs — the thin contract server in
  // front of a real PostgreSQL loaded from testdata.sql (62 tables / 18134 rows).
  // Start it with:
  //   cd db/testdata && node server/server.mjs
  // urlCheck is already off in project.config.json, so http://127.0.0.1 works in
  // the simulator without touching any setting.
  testdata: {
    baseUrl: 'http://127.0.0.1:3860/api/v1',
    name: 'testdata',
    // POST /auth/session is `blocked` on this server: it does not call WeChat, so
    // there is no js_code to exchange. It offers POST /dev/session instead, which
    // signs a session of exactly the same shape without bypassing any
    // authorization. See db/testdata/README.md §二.3.
    devSession: true,
  },
  // The real instance. The host is deliberately absent: the API domain is still
  // pending its ICP filing, and a 体验版 on a real device enforces the
  // 服务器域名 whitelist, which requires a filed domain. Fill this in when the
  // filing clears, and add the host to the Mini Program's request whitelist.
  prod: {
    baseUrl: '',
    name: 'prod',
    devSession: false,
  },
};

const ACTIVE = 'testdata';

module.exports = {
  SURFACE,
  env: ENVS[ACTIVE],
  isMock: ACTIVE !== 'prod',

  // 预览时以哪位教师的身份登录。**改这一个数就换一个用户**，改完在开发者工具里
  // 「编译」一次即可 —— 这是模拟「不同的真实用户分别看到什么」的开关。
  //
  // 只有 env.devSession 为真时才读它；生产环境的身份来自微信登录，永远不来自
  // 构建期常量。
  //
  // dataset.json 的名册（`teacher_status` s1=在职 / s2=离职，r1=主班 / r2=配班）：
  //
  //   1  陈静    大一班(class 1) 主班      7  何秀英  中二班(class 4) 主班
  //   2  李婉婷  大一班(class 1) 配班      8  吴美玲  中二班(class 4) 配班
  //   3  黄丽华  大二班(class 2) 主班      9  周雅芳  小一班(class 5) 主班
  //   4  张碧云  大二班(class 2) 配班     10  郭晓瑜  小一班(class 5) 配班
  //   5  梁凤仪  中一班(class 3) 主班     11  刘敏怡  小二班(class 6) 主班
  //   6  林淑贞  中一班(class 3) 配班     12  杨咏诗  小二班(class 6) 配班
  //
  //   13 罗慧兰  **已离职**（s2，claim 已释放）。用它登录会被服务端拒掉 ——
  //      这是数据集刻意造的反例，用来验证「凭证撤销后立刻失效」，不是坏数据。
  //
  // 换人能看出差别的地方：资源与案例库里**别人的草稿看不见**（教师 5 能看到
  // resource_id=5「香云纱的秘密」，教师 1 看不到；教师 4 能看到 case_id=6
  // 「小小点心师」，别人看不到）。党建是园所级共享，换谁看都一样。
  devSubjectId: 1,

  // §5.3 rate-limit buckets are server-side; the client only needs to respect
  // Retry-After. This is the ceiling for our own automatic retries.
  maxAutoRetries: 2,

  // §3.1: limit is 1..100, default 20.
  defaultPageLimit: 20,
};
