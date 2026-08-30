# 交接：网页原型转微信小程序

日期：2026-08-30
产物目录：`wx-test-home/`

---

## 1. 这件事在做什么

把 `https://chao0s.github.io/hualong-teacher/` 这套网页原型（56 个页面）转成一个**独立可运行的微信小程序预览工程**，放在 `wx-test-home/`。

目的是让园方在开发者工具里点着看，不是生产工程。它和仓库里原有的 `miniprogram/` **互不影响**，只是复用了同一个 AppID。

## 2. 现在到哪一步

| 项 | 数 |
|---|---|
| 原型页面（已抓取） | 56 |
| 已转成小程序页面并注册 | 47 |
| 还没转 | 9 |
| 工程文件数 | 205 |
| 工程行数 | 17897 |

自检全过。用这条命令复现：

```bash
node tools/wx-test-home-verify.js
```

五个底部 Tab 全部可进。整个工程只剩**一个主要功能缺口**：儿童成长档案里的「成长册」入口还是弹提示。

## 3. 怎么打开看

开发者工具 →「导入项目」→ 目录选 `D:\hualong-teacher\wx-test-home`。

**不要选 `D:\hualong-teacher`**，那是主工程，`miniprogram/` 才是它的根。

三个设置：模拟器机型选 390×844（iPhone 13/14 一档），**不要勾**「开启 Skyline 渲染调试」（本工程按 WebView 写），调试基础库 3.17.1 以上。

## 4. 还剩的 9 页

| 页面 | 归属 |
|---|---|
| `growth-book` | 成长册主页 |
| `growth-book-time-manage` | 在园时光管理 |
| `growth-book-task-manage` | 亲子时光管理 |
| `growth-book-section-materials` | 栏目投稿管理 |
| `growth-book-view` | 翻页预览 |
| `growth-book-sample` | 样本预览 |
| `growth-book-edit` | 学期编册 |
| `growth-book-section-edit` | 栏目版面编辑器 |
| `component-showcase` | 组件清单，设计系统对照表，**不是真页面，可以不转** |

### 建议分两批

**下一批（4 页）**：`growth-book`、`growth-book-time-manage`、`growth-book-task-manage`、`growth-book-section-materials`。

这 4 页**完全不碰 HTML 生成**，共用模块已就位，做法和前面 47 页完全一样。做完「成长册」入口就通了。

**再一批（4 页）**：三个翻页预览页 + 栏目版面编辑器。这批要重写渲染层，见下一节。

## 5. 关键决定：成长册共用模块怎么处理

原型的 `screens/growth-book-render.js` 有 663 行，**一半是把内容拼成 HTML 字符串**。小程序渲染不了 HTML 串。

已完成的处理（见 `tools/wx-port-growth-book.js`，可重跑）：

1. 搬出 345 行纯逻辑到 `wx-test-home/utils/growth-book.js`，导出 46 个。
2. 删掉 318 行产 HTML 的代码（17 个函数，名字列在模块头部注释里）。
3. `localStorage` 换成 `wx.getStorageSync` / `wx.setStorageSync`。
4. **改写了 `buildBookPlan`**：原版每页的 `content` 是 HTML 串，改成数据描述。分页规则、目录层级、兜底逻辑一字未改。

```
{ kind: 'custom',   item, pageIndex }   自定义栏目的第 n 页
{ kind: 'activity', item, source }      一条在园时光或亲子时光活动
{ kind: 'section',  section }           教师评估、五大领域、学期寄语
{ kind: 'empty' }                       该栏目尚未整理入册
```

三个预览页要按 `kind` 写 wxml。前置页的 `kind` 有 `cover` / `schoolIntro` / `title` / `toc`。

模块已用假 `wx` 验证过：12 名幼儿、5 个亲子任务，规划出 4 前置页 + 10 正文页 + 11 条目录，总 15 页，目录两级缩进和页码推算都对。

**注意：目前没有任何页面 require 这个模块，它现在是死代码。** 下一批做完 4 个管理页就会用上。

## 6. 转换手法（照着做，产物才一致）

每页产出四件套 `index.wxml / index.wxss / index.js / index.json`，放 `wx-test-home/pages/<页面名>/`。

| 原型 | 小程序 | 备注 |
|---|---|---|
| 状态栏、自绘标题栏 | **不复刻** | 微信自己画，标题走 `index.json` 的 `navigationBarTitleText` |
| `1px` | `2rpx` | 原型视口 390，沿用 `miniprogram/` 现有口径 |
| `<div>` `<span>` | `<view>` `<text>` | `<text>` 是行内，要块级得写 `display: block` |
| `<svg>` | base64 背景图 | 见 `tools/wx-test-home-icons.js`，颜色烘进图里 |
| `<table>` | 网格行 | `.prog-row` + `grid-template-columns`；`rowspan`/`colspan` 用 `grid-row/column: span n` |
| `<select>` | `<picker mode="selector">` | |
| 原生 `checkbox` | 自画方框 + 对勾 | 原生的改样式很别扭 |
| `<a href>` | `wx.navigateTo` | Tab 之间用 `wx.reLaunch`，见 `components/hl-tabbar/` |
| `color-mix()` | 算好的定值 | 小程序不认。已出现 6 处，都在注释里标了原式 |
| `data:` URI 下载 | `wx.showToast` | 小程序下不了 |
| `localStorage` | `wx.getStorageSync` | 小程序直接存对象，不用 `JSON.parse` |
| 内联 SVG 图表 | `canvas type="2d"` | 见 `utils/radar.js` |
| 锚点 `href="#x"` | `wx.pageScrollTo` | 要用 `selectViewport().scrollOffset()` 加上已滚距离 |

### 三条踩过的坑

1. **`data` 里的字段别叫 `item`**，会被 `wx:for` 的默认变量覆盖。踩过两次。
2. **`inset: 0` 简写**老 WebView 不认，四条边分开写。
3. **长列表折叠时不渲染**。质量评估 120 题、综合评估 124 题都用了这招：折叠的分组 `wx:if` 掉，展开时现渲染。折叠态本来就看不见，行为一致。

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
| `tools/wx-test-home-verify.js` | 静态自检。**每批做完必跑。** 查 JSON、JS 语法、四件套齐全、跳转目标已注册、样式类、base64 图标 |
| `tools/wx-test-home-icons.js` | 生成 36 个 base64 图标追加到各页 wxss。**重跑前先 git 还原那几个 wxss**，否则会重复追加 |
| `tools/wx-port-growth-book.js` | 转成长册共用模块，幂等，可重跑 |

自检脚本自己被修过 5 次 bug，每次都是它先误报、查下去发现是脚本的问题。**它报错时先看是不是真问题，但不要默认它错**——有两次它抓到了真漏写（`teacher-term-evaluation` 少两条规则、`comprehensive-assessment-class-report` 抬头配色整块写错）。

## 8. 原型源料在哪

`captures/` 下 56 个 `.txt`，每个是一页的完整源料（`sourceHTML` + `styles` + `scripts` + `links`），加一份 `_index.txt` 清单。

抓取工具是个人 skill `web-capture`（`C:\Users\Lin\.claude\skills\web-capture\`）。重抓命令：

```bash
node "C:/Users/Lin/.claude/skills/web-capture/scripts/capture.js" \
  --url "https://chao0s.github.io/hualong-teacher/screens/home.html,https://chao0s.github.io/hualong-teacher/screens/component-showcase.html,https://chao0s.github.io/hualong-teacher/screens/growth-book-view.html" \
  --out D:/hualong-teacher/captures
```

后两个是孤儿页，站内没有任何链接指向它们，不点名抓不到。

开工前把要转的页面抽成可读文件：

```bash
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('D:/hualong-teacher/captures/<页面名>.txt','utf8'));
const body=(p.sourceHTML.match(/<body[^>]*>([\s\S]*)<\/body>/)||[,''])[1];
fs.writeFileSync('D:/hualong-teacher/captures/_extracted/<页面名>.body.html', body.replace(/<script[\s\S]*?<\/script>/g,'').trim());
p.styles.forEach(s=>{if(s.type==='inline')fs.writeFileSync('D:/hualong-teacher/captures/_extracted/<页面名>.style.css',s.content)});
p.scripts.forEach((s,i)=>{if(s.content.trim())fs.writeFileSync('D:/hualong-teacher/captures/_extracted/<页面名>.inline'+i+'.js',s.content)});
"
```

`captures/_extracted/` 是临时抽取目录，没进版本库，需要时重新生成。

## 9. 原型自身的三个问题（**没有擅自改**）

1. **首页的评估进度徽标永远显示 0/120。** 首页读 `hualong_assessment_v1`，质量评估工具写 `hualong_assessment_school-quality-120_1.0.0`，两边不是同一个键。原型就是这样，照搬了。要对齐就改 `wx-test-home/pages/home/index.js` 的 `ASSESSMENT_STORAGE_KEY`。

2. **资源详情和案例详情是另一套配色**（米底 `#f5f4f1`、蓝主色 `#2f6feb`），其余页面是青绿 `#189b91`。原型本来就不一致。

3. **课程资源页「课程案例库」图标左边少三个点。** 原型的 SVG 写了 `M3 6h.01` 但没设 `stroke-linecap="round"`，在网页里也画不出来。照搬了。

## 10. 建议用的 skill

| skill | 什么时候用 |
|---|---|
| `web-capture` | 要重抓原型页面时。已在 `C:\Users\Lin\.claude\skills\web-capture\` |
| `context7-mcp` | 查小程序 API、组件、配置项。别凭记忆答 |
| `caveman-commit` | 写提交信息 |

**不建议**用 `huashu-design`——这是转换既有原型，不是做新设计。

## 11. 下一批的具体做法

1. 抽出 4 个页面的 body/css/js（命令见第 8 节）。
2. 逐页读，按第 6 节的对照表转。
3. 页面 `require('../../utils/growth-book.js')` 取配置和逻辑。
4. 注册进 `wx-test-home/app.json` 的 `pages`。
5. 把 `wx-test-home/pages/growth-record/index.js` 里 `ROUTES.book` 从 `null` 改成 `/pages/growth-book/index`。
6. 跑 `node tools/wx-test-home-verify.js`，必须全过。
7. 报告时给数字，别说「测试通过」。

**每批做完让用户在开发者工具里看一眼再往下走。** 这是前面七批一直在用的节奏，有效。
