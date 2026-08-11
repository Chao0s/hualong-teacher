# 化龙幼儿园 · 教师端小程序原型

> 面向幼儿园教师的一体化工作平台交互原型（High-fidelity Prototype），涵盖党建管理、综合协调、教研培训与家园共育四大业务板块，并配套「幼儿保育教育质量综合评估」工具。

本仓库为**纯静态 HTML/CSS/JS 原型**，用于产品设计评审与交互演示，暂不包含后端服务。

GitHub 仓库：<https://github.com/Chao0s/hualong-teacher>

但它已经不只是一套画面。经 2026-07-31 与 2026-08-01 两轮评审、2026-08-02 后端回覆与同日的成长册改版之后，本仓库承载了三样**有约束力**的东西：

- **成长册有了真实的版式契约，而且已经落地** —— A4 页为版面单位、15 × 24 网格、格子 10mm 精确正方、左右边距 30mm 上下 28.5mm、widget 不跨页、预设页面由后端团队作者且教师不可修改。契约全文在 `docs/frontend spec files/growth-book-layout-spec.md`（含「已对齐 / 仍有差距」对照表）；教师端的网格编辑器是 `screens/growth-book-section-edit.html`。改动成长册相关页面前必须先读它与 `decision.md` 第 16、21—26 条。
- **`decision.md` 是前后端闭环记录** —— 第 1—10 条是前端改完写给后端看的，「后端答复」一节是后端推翻或更正前端假设的地方，第 19—26 条是前端按契约落地后**反过来推翻后端已定规则**的 4 条改判。**它是本仓库改动的第一顺位参考。**
- **`data/guide-scale.json` 是综合评估的权威量表** —— 《3-6岁儿童学习与发展指南》教师评定量表 v1.0，5 领域 / 11 维度 / 32 目标 / **124 题**，题库不得在页面里另抄一份。

---

## 快速开始

无需构建，直接用浏览器打开或启动本地静态服务器即可预览。

```bash
# 方式一：直接打开总览页
# 双击 index.html

# 方式二：启动本地静态服务器（推荐，避免 iframe/文件路径限制）
python -m http.server 8000
# 然后访问 http://localhost:8000/index.html
```

- `index.html` — **5 屏并排总览页**，将 5 个主 Tab 页面以手机框形式并排展示，可点击交互。

---

## 功能模块

原型围绕 5 个底部主 Tab 组织，各模块入口页位于 `screens/` 目录：

| 主 Tab | 入口页 | 主要功能 |
| --- | --- | --- |
| 首页 | `screens/home.html` | 单张静态 Banner、近期任务（含真实未完成数）、常用入口、按教师年级筛选的推荐案例 |
| 党建管理 | `screens/school-affairs.html` | 党建学习、党建活动、品牌建设 |
| 综合协调 | `screens/comprehensive-coordination.html` | 行政统筹、通勤保障、人事管理 |
| 教研培训部 | `screens/training-center.html` | 课程建设、课程资源、教研培训、个人档案 |
| 家园共育 | `screens/home-school.html` | 在园时光、亲子任务、儿童成长档案、成长册、社区共育 |

### 两套评估工具，不要混为一谈

| 工具 | 对象 | 量表 | 数据源 |
| --- | --- | --- | --- |
| 办园质量评估 `screens/assessment-tool.html` | 幼儿园 / 班级 / 教师 | 9 个一级指标、120 题，**不含五大领域这个维度** | `screens/assessment-data.js` |
| 幼儿综合评估 `screens/comprehensive-assessment-form.html` | 单一幼儿 | 《指南》教师评定量表 v1.0，5 领域 / 124 题 | `data/guide-scale.json` |

幼儿综合评估的结果页只保留五大领域雷达图与逐题明细，**不输出任何文字性分析结论**；领域均分一律由题项级得分聚合而来（题项级均值，非下级均值的均值）。`H1-1-1` 身高体重题按 `decision.md` 第 13 条改由教师照参考表主观评定，这是对量表原典的一处**明示偏离**。

---

## 目录结构

```
.
├── index.html                 # 5 屏并排总览页（入口）
├── decision.md                # 前后端闭环决策记录（先读这个）
├── data/
│   └── guide-scale.json       # 《指南》教师评定量表 v1.0（124 题，权威）
├── screens/                   # 各业务页面原型（HTML/CSS/JS）
│   ├── home.html              # 首页
│   ├── school-affairs.html    # 党建管理
│   ├── comprehensive-coordination.html  # 综合协调
│   ├── training-center.html   # 教研培训部
│   ├── home-school.html       # 家园共育
│   ├── assessment-tool.html   # 办园质量评估工具
│   ├── assessment-data.js     # 办园质量评估量表数据
│   ├── comprehensive-assessment-form.html  # 幼儿综合评估（124 题）
│   ├── assessment-store.js    # 综合评估的题库 / 草稿 / 状态单一数据源
│   ├── growth-book*.html      # 成长册：主页 / 编辑样板 / 样本 / 单本查看
│   ├── growth-book-section-edit.html  # 新增栏目的 15×24 网格版面编辑器
│   ├── growth-book-render.js  # 成长册数据模型 + 翻页渲染（成长册各页共用）
│   └── ...                    # 其余详情页 / 表单页
├── docs/                      # 设计文档与契约
│   ├── backend spec files/    # 后端字段契约，ui= 标注的权威所在
│   ├── frontend spec files/   # 前端契约（版式、几何、交互）
│   │   └── growth-book-layout-spec.md  # 成长册 widget 网格版式契约
│   ├── 3-6岁儿童学习与发展指南——教育部.docx
│   ├── 资源与案例填写模版.docx
│   └── Archive/               # 历史归档：信息架构、交互跳转地图、评估指导手册、评估工具数据源
└── Archive/                   # 历史页面归档
```

## 文档

- **决策记录**：`decision.md` —— **改任何页面前先读**。第 1—10 条是前端评审决定，「后端答复」一节含推翻项与仍然开放的项目，第 19—26 条是 2026-08-02 的成长册改版，其中 4 条反过来推翻了后端已定规则（亲子活动一律进册、成长资料只收在园时光、`anchor_after` 取值范围、W9 的显示方式适用范围），均已同步改写 `docs/backend spec files/05 home-school-spec.md`。
- **字段契约**：`docs/backend spec files/` —— 命名权威是这些文件里的 `ui=` 标注，本仓库不另立名字。前端可自由更换文案、样式、图片、位置，但控件上的 `data-ui` 属性必须原样保留、且必须对得上某条 `ui=` 标注。新页面的写入控件须**先在 spec 补 `ui=` 标注**，再由后端重跑抽取。
- **版式契约**：`docs/frontend spec files/growth-book-layout-spec.md` —— 成长册 widget 网格的几何、像素取整、交互与渲染要求。backend spec 管**存什么**，它管**画在哪、多大、怎么点**。改成长册页面前先读。
- **信息架构**：`docs/Archive/20260627/信息架构_20260626.md`（含各模块 Mermaid 流程图）
- **交互跳转地图**：`docs/Archive/20260627/hualong_interactive_map.html`
- **评估指导手册**：`docs/Archive/20260627/幼儿园保育教育质量评价指导手册（6.13）.pdf`
- **上游后端仓库**：`../hualong-backend/` —— `DECISIONS.md`（决策，权威）、`db/GAPS.md`（未拍板项）、`db/01_schema.sql`（字段级权威）。

---

## 技术说明

- 纯前端静态原型，无构建步骤、无依赖安装。
- 页面以移动端（390×844）为基准设计，适配小程序尺寸。
- 成长册页面是例外：版面单位是 A4 实体页，手机端 fit-width 显示并**允许缩放**（每格 fit-width 时仅 18.6pt，低于 iOS 建议的 44pt）。
- `*.artifact.json` 与 `.od-skills/` 已在 `.gitignore` 中忽略。

## 状态

交互原型阶段 · 用于设计评审与演示 · 成长册版式与综合评估量表已进入契约期，改动须对照 `decision.md` · 2026
