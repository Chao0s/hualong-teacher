/**
 * Swagger UI over the API contract.
 *
 * Run:  npm run swagger          -> http://localhost:3830
 *       PORT=4000 npm run swagger
 *
 * It serves the contract straight from hualong-backend on every request, so a
 * reload shows the current file. Nothing is cached and nothing is copied.
 *
 * Two extras beyond a stock Swagger UI, both because this contract carries
 * `x-hualong-*` extensions that stock UI hides:
 *   /            the UI
 *   /roles       one HTML table of every operation with its allowed roles,
 *                its action_key and whatever GAP blocks it
 *   /openapi.yaml  the raw contract
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specPath, specText } from '../openapi-source.mjs';
import { usedFrom } from '../lib/screen-ops-data.mjs';
import { indexPage, rolesPage, specForUi, pagesSpecForUi } from './pages.mjs';
import { pagesPage } from './pages-view.mjs';
import { reviewPage } from './review-view.mjs';
import { readFeedback, upsertFeedback, STATUS, STATUS_VALUES } from '../lib/feedback.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');   // tools/swagger → 仓库根（服务 screens/ 要用）
const PORT = Number(process.env.PORT || 3830);

// swagger-ui-dist ships the browser bundle; resolving through import.meta
// avoids hard-coding node_modules, which a workspace hoist would move.
const UI_DIST = dirname(fileURLToPath(import.meta.resolve('swagger-ui-dist/swagger-ui.css')));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.yaml': 'application/yaml; charset=utf-8',
};

const INDEX = indexPage({
  specUrl: '/openapi.local.yaml',
  rolesUrl: '/roles',
  pagesUrl: '/pages',
  rawUrl: '/openapi.yaml',
  note: 'Try-it-out 默认指向本地测试后端 <code>http://127.0.0.1:3860/api/v1</code>，需有效教师会话；也可在 Servers 中选择 mock',
});

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  // 原型页：/pages 的卡头把 `screens/<名>.html` 链接印出来了（页名取自那里的可见字，
  // 见 tools/lib/screen-ops-data.mjs 的 screenTitles）。GitHub Pages 上 `screens/` 本来就发布，
  // 但**本机 server 不服务它** —— 不补这一条，本地点那个链接就是 404，而页面看起来是好的。
  if (path.startsWith('/screens/')) {
    const rel = normalize(path.slice('/screens/'.length));
    const file = join(REPO, 'screens', rel);
    const root = join(REPO, 'screens');
    if (!file.startsWith(root) || !existsSync(file)) return send(404, MIME['.html'], '<h1>404</h1>');
    return send(200, MIME[extname(file)] || 'application/octet-stream', readFileSync(file));
  }

  // ── 檢測結論：讀與寫（2026-09-12）──────────────────────────────────────
  //
  // 這是「可寫表」的另一半。上面那些路徑只服務唯讀頁面；這一條讓人的判斷回流，
  // 於是檢測從「一份報告」變成「一場對話」：發現 → 人判 → 判決落地 → 下次跑帶著它。
  //
  // 儲存只有一份：`docs/audit/checker-feedback.tsv`（`tools/lib/feedback.mjs` 是唯一讀寫它的人）。
  //
  // **守衛三層，缺一不可** —— 服務綁在 127.0.0.1 不等於安全：你機器上的瀏覽器
  // 可以被任意網站叫去發出請求。所以：
  //   1. 只收 loopback（綁定已是第一道，這一層是第二道）
  //   2. 帶 `Origin` 且不是自己 → 403（別的同源網頁不能代你寫）
  //   3. POST 必須 `application/json` → 這個 content-type 逼瀏覽器先送 preflight，
  //      而本服務**不回 OPTIONS、不發任何 CORS 標頭**，所以跨源寫入過不來。
  if (path === '/feedback') {
    const origin = req.headers.origin;
    const SELF = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];
    if (origin && !SELF.includes(origin)) {
      return send(403, 'application/json', JSON.stringify({ error: 'cross-origin refused' }));
    }

    if (req.method === 'GET') {
      const rows = [...readFeedback().values()];
      return send(200, 'application/json', JSON.stringify({ rows, status: STATUS, values: STATUS_VALUES }));
    }

    if (req.method === 'POST') {
      if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
        return send(415, 'application/json', JSON.stringify({ error: 'content-type must be application/json' }));
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1 << 16) req.destroy(); });
      req.on('end', () => {
        try {
          const { row, created } = upsertFeedback(JSON.parse(body));
          send(created ? 201 : 200, 'application/json', JSON.stringify({ ok: true, created, row }));
        } catch (err) {
          // 壞掉的輸入當場說出來（詞表外、缺 reviewer、少一個 tab…），不靜默吞掉。
          send(422, 'application/json', JSON.stringify({ error: String(err.message) }));
        }
      });
      return;
    }

    return send(405, 'application/json', JSON.stringify({ error: `method ${req.method} not allowed` }));
  }

  if (path === '/' || path === '/index.html') return send(200, MIME['.html'], INDEX);
  if (path === '/roles') return send(200, MIME['.html'], rolesPage({ homeUrl: '/', rawUrl: '/openapi.yaml', pagesUrl: '/pages', specUrl: '/pages.yaml' }));
  if (path === '/pages') return send(200, MIME['.html'], pagesPage({ homeUrl: '/', rolesUrl: '/roles', rawUrl: '/openapi.yaml', specUrl: '/pages.yaml' }));
  if (path === '/review') return send(200, MIME['.html'], reviewPage({ homeUrl: '/', pagesUrl: '/pages', rolesUrl: '/roles' }));
  if (path === '/pages.yaml') return send(200, MIME['.yaml'], pagesSpecForUi());
  if (path === '/openapi.yaml') return send(200, MIME['.yaml'], specText());
  if (path === '/openapi.local.yaml') return send(200, MIME['.yaml'], specForUi());

  // Static assets from swagger-ui-dist. normalize() collapses `..` before the
  // join, so a traversal cannot escape the dist directory.
  const rel = normalize(path).replace(/^[/\\]+/, '');
  const file = join(UI_DIST, rel);
  if (!file.startsWith(UI_DIST) || !existsSync(file)) {
    return send(404, MIME['.html'], '<h1>404</h1>');
  }
  send(200, MIME[extname(file)] || 'application/octet-stream', readFileSync(file));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Swagger UI      ->  http://localhost:${PORT}/`);
  console.log(`角色矩阵         ->  http://localhost:${PORT}/roles`);
  console.log(`按屏幕看         ->  http://localhost:${PORT}/pages`);
  console.log(`检测评审（可写） ->  http://localhost:${PORT}/review`);
  console.log(`按屏幕看的规格   ->  http://localhost:${PORT}/pages.yaml`);
  console.log(`契约文件         ->  ${specPath()}`);
{
  const u = usedFrom();
  console.log(`两份表           ->  ${u.root}  （来源：${u.how}）`);
}
});
