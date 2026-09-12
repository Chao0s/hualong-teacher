// 一次性改写 tools/swagger/server.mjs（该档是 CRLF，改完必须仍是 CRLF）。
// 用 node 直接做字符串替换，不做全文重写，改哪一处都是明确的。
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'tools/swagger/server.mjs';
let t = readFileSync(F, 'utf8');
const before = t;
const crlf0 = (t.match(/\r\n/g) || []).length;
const lone0 = (t.match(/(?<!\r)\n/g) || []).length;

const sub = (from, to) => {
  if (!t.includes(from)) throw new Error(`找不到要替换的片段：${JSON.stringify(from.slice(0, 60))}`);
  t = t.replace(from, to);
};

// ① 不再 import 那一份要被删掉的视图
sub(`import { reviewPage } from './review-view.mjs';\r\n`, '');

// ② 顶注里的路由表：/review 不再是独立一页
sub(
  ` *   /pages       one card per screen: what that screen calls\r\n *   /review      the findings as a form — one verdict per row, saved\r\n`,
  ` *   /pages       one card per screen: what that screen calls, the prototype\r\n`
  + ` *                intents it marks, and the findings — every row of every\r\n`
  + ` *                kind takes a verdict (dropdown + note + save)\r\n`
  + ` *   /review      302 -> /pages. Merged into one page on 2026-09-12: two\r\n`
  + ` *                pages for one question is why nobody could find either.\r\n`,
);

// ③ NAV_URLS 少了 review 那一项 —— 少一个键 navBar() 会当场抛，所以三个视图都要 omit 它
sub(
  `// 一条顶栏、一组链接。四个路由与四份视图共用这一个对象。\r\n`
  + `// 从前四个路由各传一个子集，于是 /roles 到不了 /review —— 少一条链接从画面上看不出来。\r\n`
  + `// 链接集合写在一处；缺键由 nav.mjs 当场抛错，不静默少一条。\r\n`
  + `const NAV_URLS = {\r\n`
  + `  home: '/',\r\n`
  + `  roles: '/roles',\r\n`
  + `  pages: '/pages',\r\n`
  + `  review: '/review',\r\n`
  + `  raw: '/openapi.yaml',\r\n`
  + `  spec: '/pages.yaml',\r\n`
  + `};\r\n`,
  `// 一条顶栏、一组链接。三个路由与三份视图共用这一个对象。\r\n`
  + `// 从前三个路由各传一个子集，于是 /roles 到不了 /review —— 少一条链接从画面上看不出来。\r\n`
  + `// 链接集合写在一处；缺键由 nav.mjs 当场抛错，不静默少一条。\r\n`
  + `//\r\n`
  + `// **没有 review 这一键**：2026-09-12 用户拍板把「检测评审」并进「按屏幕看」，\r\n`
  + `// /review 只回 302。少了这一键就要在每一处写 omit（下面 NO_REVIEW），\r\n`
  + `// 否则 navBar() 当场抛 —— 那是故意的：静默少一条链接正是这一轮要修掉的毛病。\r\n`
  + `const NAV_URLS = {\r\n`
  + `  home: '/',\r\n`
  + `  roles: '/roles',\r\n`
  + `  pages: '/pages',\r\n`
  + `  raw: '/openapi.yaml',\r\n`
  + `  spec: '/pages.yaml',\r\n`
  + `};\r\n`
  + `const NO_REVIEW = ['review'];\r\n`,
);

// ④ 三个视图都要 omit
sub(`  navUrls: NAV_URLS,\r\n  note: 'Try-it-out`, `  navUrls: NAV_URLS,\r\n  omit: NO_REVIEW,\r\n  note: 'Try-it-out`);
sub(`if (path === '/roles') return send(200, MIME['.html'], rolesPage({ navUrls: NAV_URLS }));`,
  `if (path === '/roles') return send(200, MIME['.html'], rolesPage({ navUrls: NAV_URLS, omit: NO_REVIEW }));`);
sub(`if (path === '/pages') return send(200, MIME['.html'], pagesPage({ navUrls: NAV_URLS }));`,
  `if (path === '/pages') return send(200, MIME['.html'], pagesPage({ navUrls: NAV_URLS, omit: NO_REVIEW }));`);

// ⑤ /review 改成 302
sub(
  `  if (path === '/review') return send(200, MIME['.html'], reviewPage({ navUrls: NAV_URLS }));\r\n`,
  `  // 「检测评审」已并入「按屏幕看」（用户 2026-09-12 拍板：合成一页）。\r\n`
  + `  // 旧链接 302 转过去，不留一个 404 —— 人手里那条链接还在书签里。\r\n`
  + `  if (path === '/review' || path === '/review.html') {\r\n`
  + `    res.writeHead(302, { location: '/pages', 'cache-control': 'no-store', 'content-type': MIME['.html'] });\r\n`
  + `    return res.end('<p>这一页已并入 <a href="/pages">按屏幕看</a>。</p>');\r\n`
  + `  }\r\n`,
);

// ⑥ 启动时印的那一行
sub(
  `  console.log(\`检测评审（可写） ->  http://localhost:\${PORT}/review\`);\r\n`,
  `  console.log(\`检测评审         ->  /review 302 转 http://localhost:\${PORT}/pages\`);\r\n`,
);

// 行尾：全档逐行 CRLF。原来只有 CRLF，改完也只能是 CRLF。
t = t.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
writeFileSync(F, t, 'utf8');
const crlf1 = (t.match(/\r\n/g) || []).length;
const lone1 = (t.match(/(?<!\r)\n/g) || []).length;
console.log(`改前 CRLF ${crlf0} · 单独 LF ${lone0} · 字节 ${before.length}`);
console.log(`改后 CRLF ${crlf1} · 单独 LF ${lone1} · 字节 ${t.length}`);
