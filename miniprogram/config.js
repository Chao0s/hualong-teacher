/**
 * Build-time configuration. No secrets here — this file ships inside the client
 * package and is readable by anyone who unpacks it.
 *
 * The AppSecret and the WeChat content-safety credentials belong to the server
 * (mock/.env locally, the API instance in production) and must never appear in
 * miniprogram/.
 */

// The surface identifier the API uses to pick which AppID's session rules apply.
// API-CONTRACT.md §6.2: POST /auth/session takes { surface, js_code }.
const SURFACE = 'teacher';

// API-CONTRACT.md §1.1: the major version lives in the path and only moves for
// breaking changes.
const ENVS = {
  // Local mock server (mock/server.mjs). urlCheck is off in project.config.json
  // so http://localhost works in the simulator.
  mock: {
    baseUrl: 'http://127.0.0.1:3820/api/v1',
    name: 'mock',
  },
  // The real instance. The host is deliberately absent: the API domain is still
  // pending its ICP filing, and a 体验版 on a real device enforces the
  // 服务器域名 whitelist, which requires a filed domain. Fill this in when the
  // filing clears, and add the host to the Mini Program's request whitelist.
  prod: {
    baseUrl: '',
    name: 'prod',
  },
};

const ACTIVE = 'mock';

module.exports = {
  SURFACE,
  env: ENVS[ACTIVE],
  isMock: ACTIVE === 'mock',

  // §5.3 rate-limit buckets are server-side; the client only needs to respect
  // Retry-After. This is the ceiling for our own automatic retries.
  maxAutoRetries: 2,

  // §3.1: limit is 1..100, default 20.
  defaultPageLimit: 20,
};
