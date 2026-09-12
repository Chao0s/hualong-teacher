/**
 * 顶部导航栏（navbar）—— 四个页面共用的一份实现。
 *
 * 为什么单独一个文件：`/`、`/roles`、`/pages`、`/review` 从前各写一条顶栏：
 * 四份 CSS、四组链接、同一个目的地四种叫法（`/` 在一页叫「按模块看（Swagger UI）」、
 * 在另一页叫「契约」、在第三页叫「按角色查看（x-hualong-roles）」）。人进站点看到
 * 的第一条横线就是它；它不统一，整站看起来就是四个站。
 *
 * 现在链接顺序、标签文案、尺寸、配色都只写在这里。四个页面各自只传两件东西：
 * 「我这一页是哪一站」和一组网址。
 *
 * 网址从外面传进来，因为有两套：本地服务是 `/roles` 这样的路由
 * （tools/swagger/server.mjs），GitHub Pages 是 `./roles.html` 这样的文件
 * （tools/build-api-doc.mjs）。链接**集合**不随调用方变 —— 少一个键，
 * `navBar()` 当场抛错，不静默少一条链接。
 */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/**
 * 四个页面 + 两份原件。数组顺序就是顶栏从左到右的顺序。
 * 两份原件排最后：它们是下载件，不是一站。
 */
export const NAV_ORDER = ['home', 'roles', 'pages', 'review', 'raw', 'spec'];

/**
 * 标签只有一套：同一个目的地，四页逐字相同。这是本仓库「同一样东西自始至终
 * 用同一个词」那条规矩在顶栏上的落地。
 *
 * 「按模块看」「按屏幕看」「原始契约」「按屏幕看的规格」沿用页面原来的说法；
 * 「按角色看」「按结论判」按同一句式补齐。
 */
export const NAV_LABEL = {
  home: '按模块看',       // /             Swagger UI，按模块（tag）分组
  roles: '按角色看',      // /roles        角色矩阵（x-hualong-roles）
  pages: '按屏幕看',      // /pages        一屏一卡
  review: '按结论判',     // /review       检查表：逐条选结论、写一句、存下去
  raw: '原始契约',        // /openapi.yaml
  spec: '按屏幕看的规格',  // /pages.yaml
};

/**
 * 样式也只写在这里。深底白字 + 药丸形链接。
 *
 * 旧顶栏 39px 高、13.5px 字，底色 `#e4f1ee` 与页面底 `#eef5f3` 对比 1.05:1
 * —— 两条几乎同色，读者看不出那是能点的导航。这一份底色 `#0d5a53`，与页面底
 * 对比 7.29:1；桌面 59px 高、15px 字。数值怎么量的写在 `.scratch/nav-verify.mjs`。
 *
 * `<style>` 跟链接同一份字符串交给调用方，是**故意**的：没有 build step，
 * 也就没有地方把样式提到 `<head>`；把两截分开传，早晚有一页只贴了链接忘了贴样式
 * —— 那正是这四条顶栏当初分成四份的走法。
 */
const STYLE = `<style>
/* hl-nav · 四个页面共用这一条顶栏。要改就改 tools/swagger/nav.mjs，不要在这里以外再写第二份。 */
.hl-nav{box-sizing:border-box;position:sticky;top:0;z-index:30;display:flex;flex-wrap:wrap;
  align-items:center;gap:8px 10px;padding:12px 16px;border-bottom:2px solid #06322e;
  background:#0d5a53;color:#eafaf7;
  font:15px/1.4 system-ui,-apple-system,"Segoe UI","Microsoft YaHei","Noto Sans SC",sans-serif}
.hl-nav *{box-sizing:border-box}
.hl-nav .brand{font-weight:650;color:#fff;letter-spacing:.01em;margin-right:4px}
.hl-nav a{color:#eafaf7;text-decoration:none;padding:5px 12px;border-radius:999px;
  border:1px solid rgba(255,255,255,.34);background:rgba(255,255,255,.10)}
.hl-nav a:hover{background:#fff;color:#0d5a53;border-color:#fff}
.hl-nav a[aria-current="page"]{background:#fff;color:#0d5a53;border-color:#fff;font-weight:650}
.hl-nav .now{margin-left:auto;font-size:12.5px;color:#a6cdc7}
.hl-nav .now code{font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;color:#d6efe9}
@media (max-width:900px){.hl-nav .now{display:none}}
@media (max-width:640px){.hl-nav{padding:10px 12px;font-size:14px}.hl-nav a{padding:4px 9px}}
</style>`;

/**
 * 整条顶栏：`<style>` + 一行链接。
 *
 * @param {object} o
 * @param {string} o.current   本站的键（`NAV_ORDER` 之一），画成 `aria-current="page"`
 * @param {object} o.urls      键 → 网址。缺一个键就抛错，除非列在 `omit`
 * @param {string[]} [o.omit]  这一页**不给**的目的地。例：静态站没有 `/review`；
 *        原文页不给它正在显示的那一份原件（顶栏再给第二个入口就是重复的链接）
 * @param {string} [o.title]   本站的名字，接在品牌后面（例：`角色矩阵`）
 * @param {string} [o.brand]   整条品牌文字，给了就不再拼 `化龙 API · title`
 * @param {string} [o.note]    右端说明。**可信 HTML**（本仓库自己写的），不转义
 * @param {Array<{href:string,label:string,download?:boolean}>} [o.extra]
 *        目的地的额外链接（例：`下载 YAML`、原文的 HTML 视图）
 */
export function navBar({
  current = '', urls = {}, omit = [], title = '', brand = '', note = '', extra = [],
} = {}) {
  const missing = NAV_ORDER.filter((k) => !urls[k] && !omit.includes(k));
  if (missing.length) {
    throw new Error(`navBar：缺 ${missing.join('、')} 的网址（确实要省就写进 omit）`);
  }

  const links = NAV_ORDER.filter((k) => urls[k] && !omit.includes(k)).map((k) => {
    const here = k === current ? ' aria-current="page"' : '';
    return `<a href="${esc(urls[k])}"${here}>${esc(NAV_LABEL[k])}</a>`;
  });
  for (const e of extra) {
    links.push(`<a href="${esc(e.href)}"${e.download ? ' download' : ''}>${esc(e.label)}</a>`);
  }

  const head = esc(brand || (title ? `化龙 API · ${title}` : '化龙 API'));
  const tail = note ? `<span class="now">${note}</span>` : '';
  return `${STYLE}
<nav class="hl-nav" aria-label="页间导航"><span class="brand">${head}</span>${links.join('')}${tail}</nav>`;
}
