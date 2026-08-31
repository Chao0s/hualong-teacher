---
name: web-capture
description: >
  抓取静态网页的 HTML、CSS、JavaScript，一页存一个 .txt，可沿站内链接递归抓完多级页面。
  Capture a static website's HTML, CSS and JS into one .txt per page, crawling multi-level links.
  用于把网页原型转成别的格式（微信小程序 WXML/WXSS、React 组件等）之前，先把源料完整取下来。
  触发词：抓网页、抓取网页、扒页面、把原型抓下来、导出网页源码、capture web page、scrape site、
  export page HTML CSS JS。不适用于需要登录、或内容由后端接口动态返回的站点。
---

# web-capture

把一个静态站点抓成一批 `.txt`，每个 `.txt` 是一页的完整源料：HTML 正文、页面里的 CSS、
页面里的 JS、外链的 CSS/JS 正文、站内链接表。

## 什么时候用

用：网页原型转小程序/转 React；把别人的静态站存档；要一次拿到几十个页面的样式。

不用：页面需要登录；内容由后端接口返回；单页应用（首屏 HTML 是空壳，内容全靠 JS 请求）。
这三种情况见文末「浏览器兜底」。

## 怎么跑

```bash
node "<skill目录>/scripts/capture.js" --url <起始页> --out <输出目录> [--depth N] [--limit N]
```

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `--url` | 是 | — | 起始页地址。可以给多个，逗号分隔 |
| `--out` | 是 | — | 输出目录，不存在会创建 |
| `--depth` | 否 | 99 | 跟链层数。`0` 只抓起始页 |
| `--limit` | 否 | 200 | 最多抓几页，防跑飞 |

只跟同源、且路径在第一个起始页所在目录之下的链接。三处地方找链接：

1. `<a href>` 和 `<iframe src>`。
2. **页面脚本里的 `xxx.html` 字符串。** 原型常把下级页面写成 JS 字符串再拼给 `innerHTML`，
   例如 ``item.key === 'time' ? 'time-manage.html' : 'task-manage.html'``。
   只扫标签会整支页面漏掉——实测在花龙原型上漏了 3 页。
3. 脚本模板里的 ``href="materials.html?id=${item.key}"``：占位符算不出来，但路径是真的，取路径。
   整条都是占位符的（``href="${sectionHref(item)}"``）直接丢掉，不当地址。

非 HTML 的链接（`.pdf`、`.png` 等）不当页面抓。

### 孤儿页要点名

站上常有没人链接的页面：组件示例页、还没接进去的草稿。跟链到不了，只能在 `--url` 里点名。

先跑一遍看清单，再和你手上的页面列表对一遍，缺的补进 `--url`：

```bash
node capture.js --url "https://x/a/home.html,https://x/a/showcase.html" --out ./out
```

### 先小后大

用户第一次抓一个站，先 `--limit 3` 跑一遍给他看，确认格式对了再抓整站。
一页大约 15–25 KB，56 页约 1 MB。

## 输出

```
<out>/
  _index.txt                 抓取清单：文件名、层级、标题、字节数、CSS/JS 条数、站内链接数、query 变体数
  <页面名>.txt               一页一个
```

清单末尾还有两段：**query 变体**（见下）和**失败资源**。

### 带 query 的链接只抓一次

静态站上 `page.html?a=1` 和 `page.html?b=2` 是同一个文件，服务器返回的字节一模一样。
所以按路径去重，不按整条 URL。

不这么做的后果实测过：花龙原型抓了 107 次，其中 56 次是同一批文件的不同入参，
还都写进同一个 `.txt` 里互相覆盖，清单上却显示成 107 个页面。修完是 56 次、56 个文件。

那些入参没有丢，清单末尾按页列出来：

```
query 变体（同一个 HTML，只抓了一次）:
  /screens/coordination-file-list.html
      ?type=policy
      ?type=notice
```

文件名 = 页面路径相对起始页目录，去掉 `.html`，`/` 换成 `__`。

- 从 `.../screens/home.html` 起抓 → `home.txt`、`training-center.txt`
- 从站点根目录起抓 → `screens__home.txt`、`screens__training-center.txt`

**想要干净的文件名，就从内容目录那一层起抓，不要从站点根目录起抓。**

每个 `.txt` 是一个 JSON：

| 字段 | 内容 |
|---|---|
| `capturedBy` | 固定 `http-fetch`，提醒读者这不是浏览器渲染结果 |
| `instructionsForAI` | 给读这份文件的模型的说明 |
| `environment` | 页面 URL、标题、字符集、`<meta viewport>` 声明 |
| `sourceHTML` | 服务器返回的原始 HTML 全文 |
| `styles` | 内联 `<style>` 和外链 CSS 的正文 |
| `scripts` | 内联 `<script>` 和外链 JS 的正文 |
| `resources` | 页面引用的图片等资源地址 |
| `links` | 本页指向的站内页面，用来追多级页面 |
| `failedResources` | 取不到的文件及原因 |

抓不到的字段一律不写，不编造。HTTP 抓取量不到 `devicePixelRatio`、屏幕尺寸这些。

## 拿到之后怎么用

### JS 生成的列表就是 `wx:for`

原型页常这么写：

```js
document.getElementById("materials").innerHTML = item.materials.map(name => `
  <div class="file"><div class="file-name">${name}</div></div>
`).join("");
```

这段在 `scripts` 里。`.map(...)` 对应 `wx:for`，`${name}` 对应 `{{item}}`，数组对应 `data`。
**模板和数据都在源码里，不需要渲染后的 DOM。** 渲染后的 DOM 反而把循环摊平了，还得倒推回去。

### 排版跑位要靠截图，不靠这份文件

`.txt` 里有 CSS 规则，没有最终算出来的像素值。转完之后组件位置不对，多半是这几个原因：

1. 小程序没有 `<div>` `<span>`，只有 `<view>` `<text>`，默认行内/块级行为不同。
2. `px` 换 `rpx` 的取整误差。
3. 原型里那个写死尺寸、`overflow: hidden` 的手机外壳盒子，在小程序里不存在。
4. 个别 CSS 写法两边支持程度不同。

要核对，用 chrome-devtools 开原型页、`resize_page` 成设计稿尺寸、`take_screenshot`，
再和小程序模拟器截图并排看。这一步是按页做的，不要批量做——图片很占上下文。

## 边界

| 限制 | 说明 |
|---|---|
| 正则解析 HTML | 目标是规整的手写 HTML。属性值里嵌 `>` 的畸形标签会漏 |
| 无 JS 执行 | 首屏靠 JS 请求接口渲染的页面，抓下来是空壳 |
| 无认证 | 不带 cookie，登录后才可见的页面抓不到 |
| 串行抓取 | 一页一页来，56 页约十几秒。没做并发，也没做限速 |
| 孤儿页要点名 | 没人链接的页面跟链到不了，得写进 `--url` |
| query 只抓一次 | 对静态站是对的。要是站点按 query 返回不同内容，这个假设不成立 |

抓完对一遍覆盖率，别默认爬全了。有本地源码就直接比对文件名：

```bash
for f in <本地页面目录>/*.html; do
  b=$(basename "$f" .html); [ -f "<out>/$b.txt" ] || echo "漏: $b"
done
```

## 浏览器兜底

页面内容确实由 JS 生成、而且数据不在源码里时，才走这条路。
`references/browser-console-capture.js` 是可以贴进浏览器控制台的脚本，抓的是 JS 执行后的 DOM。

两种用法：

1. **人工**：用户在浏览器按 F12 打开控制台，贴进去回车，然后执行 `copy(window.__pageExportText)`，
   粘到编辑器存成 `.txt`。
2. **自动**：用 chrome-devtools MCP 的 `evaluate_script` 跑同一段脚本，返回值写成文件。

**自动那条路每页约 30 KB 会经过模型上下文**，抓十几页就满了。只在单页排查时用，不要批量用。

脚本还会连浏览器插件注入的 DOM 和 CSS 一起抓走（实测一次抓进 5 KB 插件 CSS 和一个
`<__hrp__>` 标签）。用之前开无痕窗口，或者抓完手动删掉那些片段。
