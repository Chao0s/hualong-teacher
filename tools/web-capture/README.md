# web-capture —— 给同事的使用说明

把一个**静态**网页原型抓成一批 `.txt`，一页一个文件，里面是这一页的完整源料：
HTML 正文、页面的 CSS、页面的 JS、外链 CSS/JS 的正文、站内链接表。

用途：在把网页原型转成微信小程序（WXML/WXSS）或 React 之前，先把源料完整取下来。

详细说明在 `SKILL.md`。这份 README 只讲怎么跑起来。

---

## 1. 需要什么

只需要 Node.js（14 以上即可）。脚本只用 `fs` 和 `path` 两个内置模块，
**没有第三方依赖，不需要 `npm install`**。

验证环境：

```bash
node --version
```

## 2. 直接跑（不装 skill 也能用）

```bash
node tools/web-capture/scripts/capture.js --url <起始页> --out <输出目录> [--depth N] [--limit N]
```

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `--url` | 是 | — | 起始页地址。多个用逗号分隔 |
| `--out` | 是 | — | 输出目录，不存在会自动创建 |
| `--depth` | 否 | 99 | 跟链层数。`0` 表示只抓起始页 |
| `--limit` | 否 | 200 | 最多抓几页，防止跑飞 |

### 家长端怎么抓

这条命令实测跑通，直接复制就能用：

```bash
node tools/web-capture/scripts/capture.js \
  --url "https://chao0s.github.io/hualong-parent/screens/home.html" \
  --out ./captures-parent
```

**从 `screens/home.html` 起抓，不要从站点根目录 `https://chao0s.github.io/hualong-parent/` 起抓。**
从根目录起抓，文件名会变成 `screens__home.txt` 这种带前缀的样子；从 `screens/` 这一层起抓，
文件名就是干净的 `home.txt`。

2026-08-31 实测结果：

| 项 | 数 |
|---|---|
| 抓到的页面 | 17 |
| 仓库 `screens/` 里的 HTML | 17（一页不缺） |
| 单页大小 | 约 59–102 KB |
| 耗时 | 几秒 |

想先看一眼格式对不对，加 `--limit 3` 跑一遍，看 `captures-parent/_index.txt` 的清单。

### 孤儿页要点名

站上常有**没有任何页面链接到它**的页面：组件示例页、还没接进去的草稿。
跟链到不了，只能写进 `--url` 里点名，多个地址用逗号分隔。

**家长端目前不需要做这一步**，17 页全部能跟链到。教师端就需要，命令长这样：

```bash
node tools/web-capture/scripts/capture.js \
  --url "https://chao0s.github.io/hualong-teacher/screens/home.html,https://chao0s.github.io/hualong-teacher/screens/component-showcase.html,https://chao0s.github.io/hualong-teacher/screens/growth-book-view.html" \
  --out ./captures
```

后两个就是孤儿页，不点名抓不到。

**做法**：先跑一遍看 `_index.txt` 的清单，和你手上的页面列表对一遍，缺的补进 `--url` 再跑一次。

## 3. 装成 Claude Code skill（可选）

如果你也用 Claude Code，把 `web-capture` 整个目录复制到下面任一位置：

| 位置 | 作用范围 |
|---|---|
| `~/.claude/skills/web-capture/`（Windows：`C:\Users\<你>\.claude\skills\web-capture\`） | 你的所有项目 |
| `<项目>/.claude/skills/web-capture/` | 只在这个项目 |

复制后重开 Claude Code，输入 `/web-capture` 就能触发，或者直接说「帮我抓一下这个原型」。

## 4. 输出长什么样

```
<out>/
  _index.txt      抓取清单：文件名、层级、标题、字节数、CSS/JS 条数、站内链接数、query 变体数
  <页面名>.txt    一页一个
```

每个 `.txt` 是一个 JSON，主要字段：

| 字段 | 内容 |
|---|---|
| `sourceHTML` | 服务器返回的原始 HTML 全文 |
| `styles` | 内联 `<style>` 和外链 CSS 的正文 |
| `scripts` | 内联 `<script>` 和外链 JS 的正文 |
| `links` | 本页指向的站内页面 |
| `failedResources` | 取不到的文件及原因 |

家长端一页约 59–102 KB，17 页约 1.4 MB。

**文件名规则**：页面路径相对起始页目录，去掉 `.html`，`/` 换成 `__`。
从 `.../screens/home.html` 起抓得到 `home.txt`；从站点根目录起抓得到 `screens__home.txt`。
**想要干净的文件名，就从内容目录那一层起抓，不要从站点根目录起抓。**

## 5. 什么情况用不了

| 情况 | 结果 |
|---|---|
| 页面需要登录 | 抓不到，脚本不带 cookie |
| 内容由后端接口返回 | 抓下来是空壳 |
| 单页应用（首屏 HTML 是空的，内容全靠 JS 请求） | 抓下来是空壳 |

这三种情况走 `references/browser-console-capture.js`：在浏览器按 F12 打开控制台，
把脚本贴进去回车，再执行 `copy(window.__pageExportText)`，粘到编辑器存成 `.txt`。
抓的是 JS 执行后的 DOM。**用之前开无痕窗口**，否则浏览器插件注入的 DOM 和 CSS 会一起被抓走。

## 6. 抓失败了怎么办

`_index.txt` 末尾有一段「失败资源」。网络抖动会让个别页面或 CSS 取不到，报
`TypeError: fetch failed`。脚本没有重试，**直接把整条命令再跑一遍**即可，实测重跑就好了。

每次都失败才是真问题：先在浏览器里打开那个地址，确认它本身能访问。

## 7. 抓完对一遍覆盖率

别默认爬全了。手上有本地页面源码时，直接比对文件名：

```bash
for f in <本地页面目录>/*.html; do
  b=$(basename "$f" .html); [ -f "<out>/$b.txt" ] || echo "漏: $b"
done
```

没有本地源码时，用 GitHub API 拿一份真实页面清单来对（家长端实测 17 对 17，一页不缺）：

```bash
node -e "fetch('https://api.github.com/repos/Chao0s/hualong-parent/contents/screens',{headers:{'User-Agent':'x'}}).then(r=>r.json()).then(j=>console.log(j.filter(f=>f.name.endsWith('.html')).map(f=>f.name.replace(/\.html\$/,'')).join('\n')))"
```

把输出和 `captures-parent/` 里的 `.txt` 文件名对一遍，缺的补进 `--url` 再跑一次。
