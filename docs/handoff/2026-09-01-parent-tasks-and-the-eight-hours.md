# 交接：亲子任务 3 页，契约到 v0.8，另修掉一个全局差 8 小时的时间戳

日期：2026-09-01
前端 `D:\hualong-teacher` 分支 `master` → `caace38`（工具路径）、`0b0ce21`（三页），
本文自己是紧接其后的那一条。**未推**
后端 `D:\hualong-backend` 分支 `main` → `d76855e`（时间戳）、`a12004b`（契约与实作）。**未推**

> 接在 `2026-09-01-moments-and-contract-v07.md` 之后。那一份的 §4（做法）仍然有效。
> **后端仓库换盘了，见本文 §2。** 新踩的坑在 §6。

---

## 1. 现状

`miniprogram/` 共 **55 页**，**18 页调 API**，**37 页仍是写死的字面量**。

| 已接 | 页 | service |
|---|---|---|
| 资源与案例库 | `resource-library`、`resource-detail`、`case-library`、`case-detail`、`upload-resource` | `services/library.js` |
| 党建 | `school-affairs`、`party-study-list/detail`、`party-activity-list/detail`、`party-brand-list/detail` | `services/party.js` |
| 在园时光 | `home-school-moments`、`home-school-moment-feed`、`home-school-moment-publish` | `services/co-education.js` |
| 亲子任务 | `parent-tasks`、`parent-task-detail`、`parent-task-publish` | `services/co-education.js` |

验证口径（都是实跑的数字）：

| 检查 | 命令 | 结果 |
|---|---|---|
| 结构自检 | `npm test` | 6 项全过 |
| 孤儿样式 | `node tools/scan-orphans.mjs` | 无新增 |
| 接口探针 | `node tools/probe-{session,library,library-write,party,moments,parent-task}.mjs` | **325 项断言，0 失败** |
| 越权测试 | `node authz-tests/run.mjs --base http://localhost:3860/api/v1` | 879 次探针，七组全过 |
| 数据库 | 探针自己对账 | 逐表与 `STATS.md` 一致 |
| 后端 harness | `node db/tools/check-all.mjs` | **8 项中 1 项红**，见 §6.2 —— 不是本轮造成的 |

单支探针：session 8、library 47、library-write 20、party 64、moments 73、
**parent-task 113**。

---

## 2. 后端仓库现在在 D 盘

`D:\hualong-backend`，与本仓库是兄弟目录。**Google Drive 上那份不再更新**，
由使用者自行清理。

本轮开工时 D 盘那份落后两个提交（停在 `946b466`，缺 v0.7 的 `8c90f74`），已
`git fetch` + `git merge --ff-only` 快进到 `b7373a7`，并在 `db/testdata` 跑过
`npm install`（`pg` 与 `js-yaml`，`package.json` 是仓库里带的）。

**这件事差点毁掉整轮的计数。** 详见 §6.1。

三处路径已改：

| 文件 | 改法 |
|---|---|
| `tools/openapi-source.mjs` | **删掉** G 盘那条候选路径，只留 `../hualong-backend` |
| `tools/lib/testdata-path.mjs` | 新增。按 `../hualong-backend/db/testdata` 找，可用 `HUALONG_TESTDATA` 覆盖 |
| `tools/probe-moments.mjs`、`tools/probe-library-write.mjs` | 原本硬编码 G 盘绝对路径，改用上面那支 |

好消息两条：D 盘**没有** `db/testdata/pentest/`，所以 `git rebase` 那个坑在 D 盘
不存在；`check-all.mjs` 静默截短 `ui-binding.tsv` 那个坑也消失了（前后端同盘，
生成器找得到前端了，833 行完整）。`CLAUDE.md` §7.3 已整节重写。

---

## 3. 这一轮做了什么

### 3.1 亲子任务 3 页（读＋写＋两条状态迁移）

7 条端点全接。这一族与前三条线的差别是**计划时间**与**可编辑的草稿**：

- `start_at`／`due_at` 是 §1.2 白名单上的计划时刻，教师挑、客户端提交、必须带
  `+08:00` 字面量。原型的表单**根本没有时间输入框**，而 `start_at` 是 `NOT NULL` ——
  那张表单在原型里提交不成功。补了两组 `<picker>`。
- `s1 → s2 → s3`，两条边都是单向。所以「改」只在 `s1` 存在，`parent-task-publish`
  带 `?id=` 进来就是改草稿。

### 3.2 契约改到 v0.8

**只有加法，没有减法**：

| | 改了什么 |
|---|---|
| `ParentTask` | 增 `done_count` 与 `roster_count` 两个派生计数（不落列） |
| `ParentTaskWrite`／`ParentTaskPatch` | `start_at`／`due_at` 补指 `PlannedTime` |

第二条不是新决定，是**把一次没做完的合并做完**：片段头注写着「相关字段现指向
`PlannedTime`」，读侧的 `ParentTask` 确实改了，写侧两个 schema 漏了，`start_at` 的
描述还停在合并前那句「格式待 §1.2 修订」——而 §1.2 在 2026-08-20 就修完了。

**计数变动**：paths / operations / schemas **125 / 150 / 135 全部不变**（只在既有
schema 内加字段）；动作数 **123 不变**（状态机没动）；缺口 **69 → 71**。
理由全文在 `hualong-backend/docs/API-CONTRACT.md` §15 的 v0.8。

### 3.3 修掉一个全局差 8 小时的时间戳 —— 本轮最重的一件事

**这一条不属于亲子任务，它影响每一个端点的每一个 `*_at`，包括已经上线的 15 页。**

`db/testdata/server/lib/db.mjs` 给 `DATE(1082)` 设了「保持字符串」的 type parser，
**漏了 `TIMESTAMP(1114)`**。驱动于是把裸值按进程本地时区解析成 `Date`，`fmtAt` 再
取它的 UTC 读数并缀上 `+08:00`：

| 列 | 库里裸值 | 线上回值（修前） |
|---|---|---|
| `db_parent_task.start_at` (10) | `2026-04-30 20:00:00` | `2026-04-30T12:00:00+08:00` |
| `db_moment.published_at` (19) | `2026-04-21 16:18:00` | `2026-04-21T08:18:00+08:00` |
| `db_party_study.published_at` (3) | `2025-12-18 09:00:00` | `2025-12-18T01:00:00+08:00` |

§1.2 写的是「服务端把裸值**原样输出**再缀上园所偏移」，`db/README.md` 写的是
「驱动层不得擅自做时区转换」。上面那一串正是一次转换，只是它藏在驱动里。

**同一个根因还咬到游标**：`pageOut` 把 `r.created_at`（一个 `Date`）放进游标元组，
`JSON.stringify` 调 `toJSON()` 得到 UTC 串，解码后又当裸 timestamp 比回同一列 ——
边界偏 8 小时。当前数据集的行相隔数十天，所以**这一条尚未在分页上显形**，
机制已经证实（游标解出来是 `2026-03-21T00:00:00.000Z`，而那一行是 `08:00:00`）。

已修：补 1114 的 parser、`fmtAt` 改纯字符串操作、`shape()` 由「按类型」改为
**按列名后缀**分派（parser 之后 `instanceof Date` 再也不成立，旧判断会让裸值原样
漏出去）。另修三处进程现算的 `expires_at`（`shared.mjs` 两处、`library.mjs` 一处），
它们犯的是同一个错，新增 `fmtEpoch()` 收口。

**五支既有探针 212 项断言一支都没抓到它。** 教训写进 `CLAUDE.md` §7.6。

### 3.4 另修掉薄服务端七处与契约不符

全部用原始 HTTP 绕开客户端复现过（32 项断言），然后由 `probe-parent-task.mjs` 接管。

| # | 症状 | 后果 |
|---|---|---|
| 1 | `POST` 把 `start_at` 写成 `now()`，`due_at` 根本不 INSERT | 教师选的计划时间**收下即丢**，与上一轮的 `child_id` 同一类 |
| 2 | `/publication` 用「园所今天所在学期」派生 `term_id` | `start_at` 在别的学期时归属写错，而它发布后固定、无端点可改（F16）；成长册按 `child_id + term_id` 收录，错的归属会把提交收进错的册子 |
| 3 | `/submissions` 回 `submission_text` 与两个 `*_book_included` | 契约明写看板**不回家长正文** |
| 4 | `/submissions` 不回 `under_content_check` | 「审核中」这一档读不到 |
| 5 | `/submissions` 从提交行 INNER JOIN，且不筛 `e1` | 发布后转入的幼儿**整行消失**（不是显示未完成），已离园的仍在列 |
| 6 | `PATCH` 只改标题与详情，且用 `COALESCE` | 其余四字段改不动；`null` 清空 `task_background` 永远无效 |
| 7 | `PATCH`／`publication`／`closure` 状态不符回 **404** | 契约要 409。教师分不清「任务不存在」与「已发布不能改」 |

另加：列表端点**忽略已声明的 `parent_task_type` 筛选**（回 10 条混着 t1／t2）、
排序键是 `created_at` 而契约写 `updated_at`、不回 `task_detail`。筛选参数同时补进
游标指纹。

### 3.5 原型删掉两列，不是漏做

`parent-task-detail` 的表格从四列变三列：

| 原型的列 | 为什么不渲染 |
|---|---|
| 已读 | 全库没有任何「家长读过某条任务」的落点，没有 `read_at` |
| 提交预览 | 契约的 `ParentTaskSubmissionBoardRow` 只有五个字段，**不含家长正文**，而教师端没有配套的单笔详情端点 |

顶上三个数字里的「已读」换成「审核中」—— 那是看板真的回的一档。
两列都登记进 **G70**。

### 3.6 新增两条缺口

- **G70** 教师读不到任何一笔家长提交的正文与照片，看板行也不带
  `parent_task_submission_id`。于是 F17 的教师侧进册（`PUT /teacher/growth-book/
  task-submissions/{id}/inclusion`）**教师要盲选**：那条 PUT 按 submission id 寻址、
  还要求 `file_id` 是该笔提交已冻结附件的子集，而两样他都看不到。与 G68 同族。
- **G71** `/home-school/community-feed` 的实作回 `db_parent_task` 的行，契约声明的是
  `ParentTaskSubmission`。不是字段名不同，是**实体不同**（一条社区任务对 N 条投稿）。

---

## 4. 下一条线建议：家园其他（社区、评价、月评）4 页

6 条端点全部已实作，`services/co-education.js` 与 `services/evaluation.js` 就在旁边。

**但 `community-coeducation` 一页必须先修 G71**：按现在的回包写页面，写出来的是
「任务列表」而不是「共育 feed」，等实作改对了要整页重写。修 G71 时顺手把
`db/spec/screens.tsv` 第 33 行那张已拔除的 `db_community_submission` 一起改掉。

其余模块端点现状（teacher 可达 / 已实作）与上一份交接相同：成长册 18/18（9 页，
要先定本地存储去留 + G68）、评价与评估 9/9（10 页，要先定两个题库怎么处理）、
教研培训 7/7（6 页）、教师档案 3/3（2 页）、待办任务 3/3（2 页）、综合协调 2/2（2 页）。

`teacher-message` 两页仍接不了（契约里没有 `/notifications`），`home` 仍留到最后
（没有聚合端点）。

---

## 5. 环境

```bash
# PostgreSQL 本地 5432
cd /d/hualong-backend/db/testdata
node server/server.mjs          # → http://localhost:3860/api/v1
```

基准日 `2026-04-25`，当前学期 `2025-2026-2`（`2026-02-23`→`2026-07-10`），
上学期 `2025-2026-1`（`2025-09-01`→`2026-01-16`），两者之间 `01-17`→`02-22` 是空档 ——
`probe-parent-task.mjs` 用这个空档验「落不进学期就拒绝发布」。

换用户：改 `miniprogram/config.js` 的 `devSubjectId`。1–12 在职，**13 已离职，
登录会失败**（数据集刻意造的反例）。

---

## 6. 本轮新踩的坑

### 6.1 两份契约克隆，静默读到旧的那一份

开工时 `D:\hualong-backend` 与 `G:\...\hualong-backend` **同时存在**，而
`tools/openapi-source.mjs` 的候选表把 `../hualong-backend`（D 盘）排在 G 盘之前。
D 盘那份落后两个提交，于是：

- `npm run spec:inventory` 报 **128 paths / 153 operations**（v0.6 的数），实际是 125/150；
- `npm run docs:api` 生成的 Swagger 站点是 **v0.6**；
- **全程没有任何报错。**

这正是 `openapi-source.mjs` 头注自己警告的「一份复制品会悄悄过期」，只不过复制品
是一整个 git 克隆。那条 G 盘候选路径已删：**一份备份不是冗余，是一次静默过期。**

判断读到的是哪一份：`spec-inventory` 第一行打印契约文件的绝对路径。

### 6.2 `check-consistency` 现在是红的，且不是本轮造成的

前后端同盘之后，生成器终于看得见前端的 `captures/_extracted/`，于是发现
`screens.tsv` **少覆盖 65 个 markup 文件**（growth-book 那一族为主）。

已用 `git stash` 在原样的 `b7373a7` 上复跑确认：**同样红，同样是那 65 个**。
在 G 盘时它报的是「front-end not scanned」所以过。**这是后端 spec 的登记欠账，
不要当成刚弄坏的东西。**

另外 harness 会刷新 `db/spec/ui-binding.tsv` 的 **70 行标签文案**（「主页」→「入口页」
之类），行数仍是 833。那是生成物追上前端措辞，不是结构变化 —— 本轮已
`git checkout -- db/spec/` 还原，没有提交这份churn。

### 6.3 断言形状会把「差 8 小时」读成「格式对」

见 §3.3 与 `CLAUDE.md` §7.6。`probe-parent-task.mjs` 的做法是拿
`to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00'` 与回包逐条比，
**钉到库里的值**。

### 6.4 dataset 里的布尔值

`data-draft="{{false}}"` 取回来可能是字符串 `"false"`，而那是一个真值 ——
已发布的任务会被送进编辑页。改成在 `toCard()` 里把跳转 url 算好，只传 `data-url`。

---

## 7. 没做的

- **渲染一次都没在开发者工具里验过。** 探针桩掉了全部 UI 调用，两组 `<picker>` 的
  样式、三列表格的列宽、两个按钮的间距、确认弹窗的文案换行，全部测不到。
- **`/publication` 的状态转移与提交行播种不在同一个交易里。** 播种失败会留下一个
  `s2` 却没有提交行的任务。这是本轮之前就有的写法，不在这次的改动范围内 ——
  修它要把 `UPDATE` 与 `INSERT` 一起塞进 `tx()`。
- **G70／G71 只登记，没补。** 两条都不阻断本轮这 7 条端点。
- **列表页没有筛选 UI。** service 的 `listTasks({ status, type })` 支持，原型没有这个
  控件，本轮不发明一个。草稿靠卡片上的状态标签认。
- **`db/spec/screens.tsv` 那 65 个未覆盖的 markup** 没动（§6.2）。
- **`data/guide-scale.json` 与两个页面内题库**仍是三份，仍是一个要先问的决策。
