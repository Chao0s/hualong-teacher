/**
 * 让客户端代码在 Node 里跑起来的最小 `wx` 桩。
 *
 * 三个探针共用。桩住的只有**平台 API**（存储与网络），其上的每一层 ——
 * `utils/request.js`、`utils/derived.js`、`services/*` —— 都是原样加载的发布代码。
 * 桩得再多一点，测的就不是客户端了。
 *
 * 与真机的差异，逐条写明，免得把探针的绿灯误读成「模拟器里点过了」：
 *   - `wx.request` 走 `fetch`，超时与重试语义与真机不同（`utils/request.js` 的
 *     自动重试仍然会跑，因为那一层在桩之上）；
 *   - 存储是进程内的 Map，不跨进程，也不模拟 10MB 上限；
 *   - 一切 UI 调用（toast／modal／loading／navigate）都是空函数。**渲染、
 *     `<editor>`、canvas、拖曳、翻页动画一概测不到**，那些只能在开发者工具里真点。
 */

const storage = new Map();

export function installWxStub() {
  globalThis.wx = {
    getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
    setStorageSync: (k, v) => { storage.set(k, v); },
    removeStorageSync: (k) => { storage.delete(k); },
    showToast: () => {},
    showModal: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    navigateTo: () => {},
    reLaunch: () => {},
    setNavigationBarTitle: () => {},
    setClipboardData: () => {},
    request({ url, method, header, data, success, fail }) {
      fetch(url, {
        method,
        headers: header,
        body: data === undefined || method === 'GET' ? undefined : JSON.stringify(data),
      })
        .then(async (res) => {
          const text = await res.text();
          let body = text;
          try { body = JSON.parse(text); } catch { /* 保留原文 */ }
          success({
            statusCode: res.status,
            data: body,
            header: Object.fromEntries(res.headers.entries()),
          });
        })
        .catch((err) => fail({ errMsg: String(err && err.message ? err.message : err) }));
    },
  };
}

/** 计分板。三个探针的报告口径一致：给数字，不给「通过了」。 */
export function scoreboard() {
  let pass = 0;
  let fail = 0;
  const failures = [];
  const notes = [];

  return {
    check(name, cond, detail) {
      if (cond) { pass += 1; return; }
      fail += 1;
      failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    },
    /**
     * 服务端的已知缺口：客户端做对了，对面还没接住。
     *
     * 单独记而不是算成失败，否则每次跑都红一条，红久了就没人看了。也不能悄悄
     * 删掉 —— 删掉之后「客户端发错了」与「服务端没接住」在报告上长得一模一样。
     */
    note(what, evidence) {
      notes.push(`${what}\n      证据：${evidence}`);
    },
    has(obj, keys, label) {
      keys.forEach((k) => this.check(
        `${label}.${k} 存在`,
        obj && obj[k] !== undefined,
        `实际收到的键：${obj ? Object.keys(obj).join(', ') : '(空)'}`
      ));
    },
    report() {
      console.log(`\n${pass} 项通过，${fail} 项失败${notes.length ? `，${notes.length} 条服务端已知缺口` : ''}。`);
      if (failures.length) {
        console.log('\n失败项：');
        failures.forEach((f) => console.log(`  - ${f}`));
      }
      if (notes.length) {
        console.log('\n服务端已知缺口（客户端做对了，对面还没接住）：');
        notes.forEach((n) => console.log(`  - ${n}`));
      }
      // 设 exitCode 而不是 exit()：exit() 会在 fetch 的 keep-alive 连接还开着时
      // 把 libuv 打断，进程带着一句 assertion 噪音退出，看起来像测试炸了。
      process.exitCode = fail === 0 ? 0 : 1;
    },
  };
}
