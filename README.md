# 化龙幼儿园 · 教师端小程序原型

> 面向幼儿园教师的一体化工作平台交互原型（High-fidelity Prototype），涵盖党建管理、综合协调、教研培训与家园共育四大业务板块，并配套「幼儿保育教育质量综合评估」工具。

本仓库为**纯静态 HTML/CSS/JS 原型**，用于产品设计评审与交互演示，暂不包含后端服务。

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
- `landing.html` — 产品落地页 / 介绍页。

---

## 功能模块

原型围绕 5 个底部主 Tab 组织，各模块入口页位于 `screens/` 目录：

| 主 Tab | 入口页 | 主要功能 |
| --- | --- | --- |
| 首页 | `screens/home.html` | 轮播 Banner、待办事项、常用入口、推荐课程资源 |
| 党建管理 | `screens/school-affairs.html` | 党建学习、党建活动、品牌建设 |
| 综合协调 | `screens/comprehensive-coordination.html` | 行政统筹、通勤保障、人事管理 |
| 教研培训部 | `screens/training-center.html` | 课程建设、课程资源、教研培训、个人档案 |
| 家园共育 | `screens/home-school.html` | 在园时光、亲子任务、儿童成长档案、成长册、社区共育 |

### 特色工具：幼儿保育教育质量综合评估

- `screens/assessment-tool.html` — 交互式评估工具页
- `screens/assessment-data.js` — 评估量表数据（五大领域李克特量表：健康 / 语言 / 社会 / 科学 / 艺术）
- 支持个人 / 班级评估、雷达图、强弱项分析与报告导出

---

## 目录结构

```
.
├── index.html                 # 5 屏并排总览页（入口）
├── landing.html               # 产品落地页
├── screens/                   # 各业务页面原型（HTML/CSS/JS）
│   ├── home.html              # 首页
│   ├── school-affairs.html    # 党建管理
│   ├── comprehensive-coordination.html  # 综合协调
│   ├── training-center.html   # 教研培训部
│   ├── home-school.html       # 家园共育
│   ├── assessment-tool.html   # 综合评估工具
│   ├── assessment-data.js     # 评估量表数据
│   └── ...                    # 其余详情页 / 表单页
├── docs/                      # 设计文档与信息架构
│   ├── 信息架构_20260626.md   # 最新信息架构（含 Mermaid 流程图）
│   ├── hualong_interactive_map.html  # 交互跳转地图
│   ├── assessment_tool.json   # 评估工具数据源
│   └── 幼儿园保育教育质量评价指导手册（6.13）.pdf
└── Archive/                   # 历史归档
```

## 文档

- **信息架构**：`docs/信息架构_20260626.md`（最新，含各模块 Mermaid 流程图）
- **交互跳转地图**：`docs/hualong_interactive_map.html`
- **评估指导手册**：`docs/幼儿园保育教育质量评价指导手册（6.13）.pdf`

---

## 技术说明

- 纯前端静态原型，无构建步骤、无依赖安装。
- 页面以移动端（390×844）为基准设计，适配小程序尺寸。
- `*.artifact.json` 与 `.od-skills/` 已在 `.gitignore` 中忽略。

## 状态

🚧 交互原型阶段 · 用于设计评审与演示 · 2026
