# 交接：网页原型转微信小程序

开工：2026-08-30 · 完工与改组：2026-08-31
产物目录：`miniprogram/`（2026-08-31 前叫 `wx-test-home/`）

---

## 0. 2026-08-31 的改组，先读这条

工程搬过一次家，**旧文档里的 `wx-test-home/` 一律读作 `miniprogram/`**。

| 动作 | 从 | 到 |
|---|---|---|
| 旧原生小程序归档 | `miniprogram/` | `Archive/20260831/miniprogram/` |
| 它的 733 个测试一并归档 | `tests/` | `Archive/20260831/tests/` |
| 两个只服务旧工程的校验工具 | `tools/verify-build.mjs`、`tools/schema-conformance.mjs` | `Archive/20260831/tools/` |
| **本工程提升接手正统名字** | `wx-test-home/` | `miniprogram/` |
| 自检脚本改名 | `tools/wx-test-home-verify.js` | `tools/verify-miniprogram.js` |
| 图标脚本改名 | `tools/wx-test-home-icons.js` | `tools/wx-icons.js` |
| `npm test` 改指向 | 733 个 `node --test` | `node tools/verify-miniprogram.js` |

归档理由与捡回办法写在 `Archive/20260831/README.md`。

## 1. 这件事在做什么

把 `https://chao0s.github.io/hualong-teacher/` 这套网页原型（56 个页面）转成一个**可运行的微信小程序预览工程**。

目的是让园方在开发者工具里点着看。**它不调任何接口**，没有 service 层，不是生产工程；数据全在 `wx.setStorageSync` 里。

## 2. 现在到哪一步

**转完了。**

| 项 | 数 |
|---|---|
| 原型页面（已抓取） | 56 |
| 已转成小程序页面并注册 | 55 |
| 没转 | 1（`component-showcase`，设计系统对照表，不是真页面） |
| 工程文件数 | 241 |
| 工程行数 | 22687 |

自检全过。用这两条命令任选其一复现：

```bash
npm test
node tools/verify-miniprogram.js
```

五个底部 Tab 全部可进，成长册整条线（入口 → 学期编册 → 四个管理页 → 三个翻页预览 → 版面编辑器）全通。

## 3. 怎么打开看

开发者工具 →「导入项目」→ 目录选 `D:\hualong-teacher`（**仓库根目录**）。

根目录的 `project.config.json` 里 `miniprogramRoot` 是 `miniprogram/`，工具会自己找进去。工程内部不再放第二份 `project.config.json`。

三个设置：模拟器机型选 390×844（iPhone 13/14 一档），**不要勾**「开启 Skyline 渲染调试」（本工程按 WebView 写），调试基础库 3.17.1 以上。

## 4. 唯一没转的一页

`component-showcase` —— 组件清单，设计系统对照表，不是真页面。

`growth-book-view`（单名幼儿翻页预览）已转，但**站内没有入口**：原型里它就是孤儿页，没有擅自加链接。要看它，在开发者工具用「编译模式」自定义启动页，参数填 `child=wang` 之类。

## 5. 关键决定：成长册共用模块怎么处理

原型的 `screens/growth-book-render.js` 有 663 行，**一半是把内容拼成 HTML 字符串**。小程序渲染不了 HTML 串。

已完成的处理（见 `tools/wx-port-growth-book.js`，可重跑）：

1. 搬出 345 行纯逻辑到 `miniprogram/utils/growth-book.js`。
2. 产 HTML 的 17 个函数没有照搬，**改写成数据版**（名字对照列在模块头部注释里）。
3. `localStorage` 换成 `wx.getStorageSync` / `wx.setStorageSync`。
4. **改写了 `buildBookPlan` 与 `buildBookPages`**：原版每页的 `content` 是 HTML 串，改成数据描述。分页规则、目录层级、兜底逻辑一字未改。

正文 `content` 的四种 `kind`：

```
{ kind: 'custom',   item, pageIndex }   自定义栏目的第 n 页
{ kind: 'activity', item, source }      一条在园时光或亲子时光活动
{ kind: 'section',  section }           教师评估、五大领域、学期寄语
{ kind: 'empty' }                       该栏目尚未整理入册
```

`buildBookPages` 再把它包成整册的页面清单，页面 `kind` 六种：
`cover` / `schoolIntro` / `title` / `toc` / `body` / `backCover`。

渲染分工（三个预览页共用）：

| 文件 | 管什么 |
|---|---|
| `miniprogram/templates/growth-book-page.wxml` | 按 `kind` 摆一页的 `<template name="bookPage">` |
| `miniprogram/styles/growth-book-viewer.wxss` | 书本样式；五大领域的雷达图分数写死，烘成 base64 SVG |
| `miniprogram/utils/book-viewer.js` | 翻页控制，搬自原型的 `initBookViewer` |

## 6. 转换手法（照着做，产物才一致）

每页产出四件套 `index.wxml / index.wxss / index.js / index.json`，放 `miniprogram/pages/<页面名>/`。

| 原型 | 小程序 | 备注 |
|---|---|---|
| 状态栏、自绘标题栏 | **不复刻** | 微信自己画，标题走 `index.json` 的 `navigationBarTitleText` |
| `1px` | `2rpx` | 原型视口 390。**例外**：栏目版面编辑器的画布用 px，见第 6 节末尾 |
| `<div>` `<span>` | `<view>` `<text>` | `<text>` 是行内，要块级得写 `display: block` |
| `<svg>` | base64 背景图 | 见 `tools/wx-icons.js`，颜色烘进图里 |
| `contenteditable` + `execCommand` | `<editor>` + `EditorContext.format` | 存取用 delta，与 run 阵列一一对应 |
| `window.confirm` | `wx.showModal` | 是异步的，原来一步的流程要拆两步 |
| `pointer` 事件 | `touch` 事件 | 拖曳把 `catchtouchmove` 挂在容器上，别让页面跟着滚 |
| `<table>` | 网格行 | `.prog-row` + `grid-template-columns`；`rowspan`/`colspan` 用 `grid-row/column: span n` |
| `<select>` | `<picker mode="selector">` | |
| 原生 `checkbox` | 自画方框 + 对勾 | 原生的改样式很别扭 |
| `<a href>` | `wx.navigateTo` | Tab 之间用 `wx.reLaunch`，见 `components/hl-tabbar/` |
| `color-mix()` | 算好的定值 | 小程序不认。已出现 6 处，都在注释里标了原式 |
| `data:` URI 下载 | `wx.showToast` | 小程序下不了 |
| `localStorage` | `wx.getStorageSync` | 小程序直接存对象，不用 `JSON.parse` |
| 内联 SVG 图表 | `canvas type="2d"` | 见 `utils/radar.js` |
| 锚点 `href="#x"` | `wx.pageScrollTo` | 要用 `selectViewport().scrollOffset()` 加上已滚距离 |

### 五条踩过的坑

1. **`data` 里的字段别叫 `item`**，会被 `wx:for` 的默认变量覆盖。踩过两次。
2. **`inset: 0` 简写**老 WebView 不认，四条边分开写。
3. **长列表折叠时不渲染**。质量评估 120 题、综合评估 124 题都用了这招：折叠的分组 `wx:if` 掉，展开时现渲染。折叠态本来就看不见，行为一致。
4. **`wx:for` 与 `wx:else` 不能挂在同一个节点上。** 编译器只报「wx:if not found」，看半天看不出问题出在 `for` 上。要分支就套一层 `<block wx:else>`。自检脚本第 6 项现在专查这个。
5. **类名 `.page` 在成长册预览页是「书里的一页」**，不是页面根容器。那三页的根容器叫 `.screen`。

### 画布为什么用 px 不用 rpx

只有 `growth-book-section-edit` 一页例外。格子边长要精确正方，拖曳位移又要和触摸坐标（`e.touches[0].pageX`，单位是 px）同一把尺；换成 rpx 两者会差百分之几，拖久了就对不上格。代价是画布不随机型宽度缩放——它本来就是一张 A4 文档预览，自带缩放按钮。画布以外照旧 1px 记 2rpx。

### 大数据怎么办

题库、量表这类几十 KB 的常量**不要手抄**，写脚本机械转换成模块。已经这么做了三次：

| 模块 | 来源 | 大小 |
|---|---|---|
| `pages/assessment-tool/assessment-data.js` | `screens/assessment-data.js` | 79 KB / 120 题 |
| `utils/assessment-store.js` | `screens/assessment-store.js` | 124 题量表 + 草稿存储 |
| `pages/comprehensive-assessment-form/questions.js` | 页内 `domains` 常量 | 50 KB / 124 题 |

## 7. 工具

| 文件 | 用途 |
|---|---|
| `tools/verify-miniprogram.js` | 静态自检，也是 `npm test`。**每批做完必跑。** 六项：JSON、JS 语法、四件套齐全、跳转目标已注册、样式类、base64 图标、`wx:for`/`wx:else` 冲突 |
| `tools/wx-icons.js` | 生成 36 个 base64 图标追加到各页 wxss。**重跑前先 git 还原那几个 wxss**，否则会重复追加 |
| `tools/wx-port-growth-book.js` | 转成长册共用模块，幂等，可重跑 |
| `tools/wx-extract-capture.js` | 从 `captures/*.txt` 抽出 body/css/js。**转换前的第一步** |

自检脚本自己被修过 7 次 bug，每次都是它先误报、查下去发现是脚本的问题。**它报错时先看是不是真问题，但不要默认它错**——有两次它抓到了真漏写（`teacher-term-evaluation` 少两条规则、`comprehensive-assessment-class-report` 抬头配色整块写错）。

后加的两项检查值得记一笔：第 6 项（`wx:for` 与 `wx:else` 同节点）是编译报错之后补的，补完拿真 bug 验证过它抓得住；第 4 项现在会把 `<import>` 进来的模板一起并进来查，否则模板里的类名没人管。

## 8. 原型源料在哪

**56 页的源料已经在版本库里**：`captures/` 下 56 个 `.txt`，每个是一页的完整源料
（`sourceHTML` + `styles` + `scripts` + `links`），加一份 `_index.txt` 清单。

**转换前不需要重新抓站。** 直接抽出来读：

```bash
node tools/wx-extract-capture.js growth-book growth-book-time-manage
node tools/wx-extract-capture.js --all
```

产出到 `captures/_extracted/`（不进版本库，随时可重建）。每页给出
`.body.html`（去掉 script 的正文）、`.style.css`（页面自己的样式）、
外链样式和脚本各自的正文（如 `.home-school-common.css`、`.growth-book-render.js`）、
`.inline0.js`（内联脚本）。

### 什么时候才需要重抓

只有两种情况：原型重新部署了，或者 `captures/` 里确实缺页。那时用个人 skill
`web-capture`（`C:\Users\Lin\.claude\skills\web-capture\`）：

```bash
node "C:/Users/Lin/.claude/skills/web-capture/scripts/capture.js" \
  --url "https://chao0s.github.io/hualong-teacher/screens/home.html,https://chao0s.github.io/hualong-teacher/screens/component-showcase.html,https://chao0s.github.io/hualong-teacher/screens/growth-book-view.html" \
  --out D:/hualong-teacher/captures
```

后两个是孤儿页，站内没有任何链接指向它们，不点名抓不到。

## 9. 原型自身的三个问题（**没有擅自改**）

1. **首页的评估进度徽标永远显示 0/120。** 首页读 `hualong_assessment_v1`，质量评估工具写 `hualong_assessment_school-quality-120_1.0.0`，两边不是同一个键。原型就是这样，照搬了。要对齐就改 `miniprogram/pages/home/index.js` 的 `ASSESSMENT_STORAGE_KEY`。

2. **资源详情和案例详情是另一套配色**（米底 `#f5f4f1`、蓝主色 `#2f6feb`），其余页面是青绿 `#189b91`。原型本来就不一致。

3. **课程资源页「课程案例库」图标左边少三个点。** 原型的 SVG 写了 `M3 6h.01` 但没设 `stroke-linecap="round"`，在网页里也画不出来。照搬了。

## 10. 建议用的 skill

| skill | 什么时候用 |
|---|---|
| `web-capture` | **一般用不上**。源料已在 `captures/`，只有原型重新部署或确实缺页才用 |
| `context7-mcp` | 查小程序 API、组件、配置项。别凭记忆答 |
| `caveman-commit` | 写提交信息 |

**不建议**用 `huashu-design`——这是转换既有原型，不是做新设计。

## 11. 再改这个工程时的做法

56 页已经转完，这一节留给后续改动。

1. 要对着原型改，先抽源料，**不用抓站**：
   ```bash
   node tools/wx-extract-capture.js <页面名> [<页面名> ...]
   ```
2. 按第 6 节的对照表转，别自创写法——产物一致比聪明重要。
3. 成长册相关的页面 `require('../../utils/growth-book.js')` 取配置和逻辑，**不要在页面里重写判定**。
4. 新页面要注册进 `miniprogram/app.json` 的 `pages`。
5. 跑 `npm test`（即 `node tools/verify-miniprogram.js`），必须全过。
6. 报告时给数字，别说「测试通过」。

**静态自检只查得出结构问题。** `<editor>`、`canvas`、拖曳、翻页动画这些都要在开发者工具里真点一遍。改完让用户看一眼再往下走——这是前面九批一直在用的节奏，有效。
