# 成长册 17 条端点：服务端实作状态与 G68 的边界

GitHub issue #16（L4）。只读研究，2026-09-08。

数据来源：`D:/hualong-backend` 的 `db/testdata/server/routes/teacher-book.mjs`、
`routes/shared.mjs`、`api/openapi.yaml`、`api/action-registry.tsv`、
`api/action-coverage.tsv`、`db/testdata/authz-tests/coverage.tsv`、`db/GAPS.md`、
`db/01_schema.sql`、`db/testdata/STATS.md`；本机 `http://localhost:3860/api/v1`
（teacher 1 陈静，class_id 1）的 GET 实测；`hualong_test` 库的行数核对。

> **这份是 2026-09-09 的快照。后来的事写在这里，别照着过期的结论做。**
>
> | 本文说 | 后来 |
> |---|---|
> | `POST …/compilation` 已存在时回 409，与契约的「幂等取回」不符 | **已修**（#29）：回 200 并带 `compilation_id` |
> | `GET …/precheck` 回 `{items, next_cursor}`，契约是 `ClassPrecheck` | **已修**（#29）：回 `{content_fingerprint, children[]}`，按编册过滤 |
> | 三条端点契约要幂等键、实作读不到 | **已修**（#29）：请求头到得了 handler |
> | 「17 条全部有 handler」——但没人真跑过写入 | **两条实为 500**（#63）：`POST …/time-topics` 与 `POST …/books` 的 SQL 参数类型推断失败（42P08），已加 `::varchar` 修掉；两支探针现在 131/0 与 92/0 |
> | 「阻于 G68 的是 0 条」 | 仍然成立。G68 那一族端点由 F29 建起来（后端 PR #27） |

## 1. 结论

| 计数 | 数 | 是哪几条 |
|---|---|---|
| 路由文件已实作 | **17 / 17** | 全部。薄契约服务端**没有一条**会回 501 |
| 阻于 G68 | **0** | G68 阻的端点在契约里不存在，不在这 17 条里（§3） |
| 阻于版式包（`x-hualong-blocked-on`） | **2** | `GET …/manifest`、`GET …/pages/{ordinal}`，实测回 409 |
| 现在就能接 | **15** | 15 条教师端栏目／编册端点。其中 2 条实作与契约不符（`POST …/compilation` 已存在时回 409、`GET …/precheck` 回包形状），接之前要先处置（§5） |

## 2. 17 条端点逐条

「阻于」一列写的是**接客户端时**会挡住的东西，不是服务端有没有 handler。
「依赖它的小程序页面」按 `index.json` 的 `navigationBarTitleText` 写中文标题，
路径都从底部导航「家园社共育」→ 成长档案 → 成长册 起步。

| # | 端点 | 路由文件已实作？ | 实测状态码或未实测 | 阻于 | 依赖它的小程序页面 |
|---|---|---|---|---|---|
| 1 | `POST /teacher/growth-book/compilation`（取回或建立本班本学期编册，NONE→e1） | 是，`teacher-book.mjs:75` | 未实测（会写库） | **实作漂移**：编册已存在时回 409，契约说「幂等取回」（§5） | `growth-book`（成长册）、`growth-book-edit`（2026 春季学期编册）—— 两页都要先拿到 `compilation_id` 与 `compilation_status`，而契约没有 GET |
| 2 | `PATCH /teacher/growth-book/compilation/{compilation_id}`（改栏目勾选，仅 e1，revision CAS） | 是，`:91` | 未实测（会写库） | 无 | `growth-book-edit` 的栏目开关 `onToggleSection` |
| 3 | `POST /teacher/growth-book/compilation/{compilation_id}/lock`（锁定编册，e1→e2） | 是，`:118` | 未实测（不可逆） | 无。契约要求幂等键；实作未读幂等键 | `growth-book-edit` 的「锁定编册」`onLock` |
| 4 | `GET /teacher/growth-book/sections`（本班本学期栏目清单） | 是，`:130` | **200**。回 2 条（section_id 1、2），与库里 class_id=1 的 2 行逐 id 相同 | 无 | `growth-book`、`growth-book-edit`（新增栏目列表） |
| 5 | `POST /teacher/growth-book/sections`（新增栏目，NONE→d1） | 是，`:145` | 未实测（会写库） | 无 | `growth-book-section-edit`（栏目版面，`?new=1` 进入） |
| 6 | `PATCH /teacher/growth-book/sections/{section_id}`（改栏目，仅 d1） | 是，`:163` | 未实测（会写库） | 无 | `growth-book-section-edit` 改名 |
| 7 | `DELETE /teacher/growth-book/sections/{section_id}`（删草稿栏目，仅 d1） | 是，`:178` | 未实测（不可逆） | 无 | `growth-book-section-materials`（栏目投稿）`onDeleteSection` |
| 8 | `PUT /teacher/growth-book/sections/{section_id}/widgets`（整栏目保存 widget 版面，仅 d1） | 是，`:203`，含 `validateWidgets` 重叠校验 | 未实测（会写库） | 无 | `growth-book-section-edit` 的画布保存 |
| 9 | `POST /teacher/growth-book/sections/{section_id}/publication`（发布栏目，d1→d2，版面冻结） | 是，`:241` | 未实测（不可逆） | 无 | `growth-book-section-edit` 的「发布」 |
| 10 | `POST /teacher/growth-book/sections/{section_id}/collection`（发起征集，c1→c2） | 是，`:264` | 未实测（会写库） | 无 | `growth-book-section-materials` |
| 11 | `DELETE /teacher/growth-book/sections/{section_id}/collection`（撤回征集，c2→c1，同事务删本轮 `db_book_material_submission`） | 是，`:280` | 未实测（不可逆，会删行） | 无 | `growth-book-section-materials` |
| 12 | `POST /teacher/growth-book/sections/{section_id}/reminders`（提醒未交齐的家长，建 n4 通知） | 是，`:305` | 未实测（会写 `db_notification`） | 无。契约要求幂等键；实作未读幂等键 | `growth-book-section-materials` 的 `onRemind` |
| 13 | `POST /teacher/growth-book/books`（全班建册，NONE→b1，绑定 pack_code／layout_seed／book_release_id） | 是，`:369` | 未实测（会写库） | 无 | `growth-book`（进入检查表前要保证每名幼儿有册） |
| 14 | `GET /teacher/growth-book/precheck`（全班预检，零写入） | 是，`:340` | **200**，但回包形状与契约 `ClassPrecheck` 不符，且 10 名幼儿回 20 行（§5） | **回包漂移**，要先修服务端或登记缺口 | `growth-book` 的检查表与「全班定稿」弹层 |
| 15 | `POST /teacher/growth-book/books/{growth_book_id}/publication`（逐册定稿，b1→b2，建 n5 通知） | 是，`:396` | 未实测（不可逆） | 无。契约要求 `content_fingerprint` 与幂等键；实作两者都未读 | `growth-book` 的 `finalize` |
| 16 | `GET /growth-book/books/{growth_book_id}/manifest`（解析整册 manifest） | 是，`shared.mjs:236`，但 handler 只做范围判定后回 409 | **409** `state_precondition_failed` / `no_released_layout_pack`（growth_book_id 1）；范围外 id 99999 回 **404** | `x-hualong-blocked-on`：0/12 released layout pack（ADR-0015 Follow-ups） | `growth-book-view`（成长册预览）、`growth-book-sample`（成长册样本）、`growth-book-edit` 上半的实时预览 |
| 17 | `GET /growth-book/books/{growth_book_id}/pages/{ordinal}`（按页取内容） | 是，`shared.mjs:244`，同上 | **409** 同上 | 同上，另加「派生尺寸的 CI 步骤待第一份 pack」 | 同上三页 |

三份登记表对这 17 条的口径一致：

| 登记表 | 记法 |
|---|---|
| `api/action-registry.tsv` | 第 48–60 行登记 #1–#13、#15 共 14 条动作；#14 precheck 零写入、刻意不登记（契约 description 写明）；#16／#17 是读，不登记 |
| `api/action-coverage.tsv` | `db_growth_book_compilation.compilation_status`、`db_growth_book_section.section_status`／`collection_status`、`db_growth_book.book_status` 四行都是 `covered` |
| `db/testdata/authz-tests/coverage.tsv` | 第 53–69 行 17 条全部 `implemented`（这份账本由 `router.mjs` 的 `coverage()` 从契约算出，不是手写） |

### 实测怎么做的

```
POST /dev/session {"surface":"teacher","subject_id":1}  → token（陈静，class_id 1）
GET  /teacher/growth-book/sections                      → 200，items 2 条
GET  /teacher/growth-book/precheck                      → 200，items 20 条
GET  /growth-book/books/1/manifest                      → 409 no_released_layout_pack
GET  /growth-book/books/1/pages/1                       → 409 no_released_layout_pack
GET  /growth-book/books/99999/manifest                  → 404 not_found（范围外先 404，刻意的顺序）
```

写入端点一条都没打。`sections` 那 2 条与库里 `db_growth_book_section JOIN
db_growth_book_compilation WHERE class_id=1` 的 2 行逐 `section_id` 相同（1 与 2）。

## 3. G68 的边界

G68（在园时光与社区投稿的入册通道有表有数据、零 API 面，`db/GAPS.md` 第 897 行）
阻的是下面这一族，**不是**上面 17 条里的任何一条：

| G68 阻的 | 表 | 端点 | 页面 |
|---|---|---|---|
| 把一条在园时光／社区投稿登记进本学期编册（列表／加入／移出／批量分节） | `db_growth_material`（在园时光／社区投稿 → 成长册的班级级素材通道，138 行） | **契约里一条都没有**。28 条 growth-book 端点全落在 setting／assignments／sections／widgets／compilation／books／manifest | `home-school-moment-feed`（全部活动）的「加入成长册」勾选；`growth-book-time-manage`（在园时光管理） |
| 在园时光主题的增删改名 | `db_growth_book_time_topic`（编册里在园时光的主题，36 行） | 同上，一条都没有 | `growth-book-time-manage` |

两页现在都写 `wx.setStorageSync`（`utils/growth-book.js` 的 `BOOK_STORE_KEY`），换设备即失。
G68 明说「两页要的是同一族端点，补的时候要一次定完」。

**同族但另有编号的两条**，也不在 17 条里：

| 编号 | 阻的 | 页面 |
|---|---|---|
| G70（教师读不到家长提交的正文与 id） | `PUT /teacher/growth-book/task-submissions/{parent_task_submission_id}/inclusion`（教师分支进册，改 `db_parent_task_submission.teacher_book_included`）。端点已实作（`teacher.mjs:605`），但看板行不回 `parent_task_submission_id`，教师要盲选 | `growth-book-task-manage`（亲子时光管理）、`parent-task-detail`（任务详情，亲子任务那条线） |
| 未登记 | `db_growth_book_task_item`（编册里亲子活动的收录顺序，54 行）在契约里只出现在一行注释（`openapi.yaml:1448`「模块三」），零端点 | `growth-book-task-manage` |

所以「栏目／编册」与「入册通道」是**两回事**：

| | 栏目／编册（本文 17 条） | 入册通道（G68 一族） |
|---|---|---|
| 管什么 | 教师新增栏目的版面、征集、编册锁定、逐册定稿、取页 | 哪些在园时光／亲子活动进这本册、归哪个主题 |
| 表 | `db_growth_book_compilation`、`db_growth_book_section`、`db_book_widget`、`db_book_material_submission`、`db_growth_book` | `db_growth_material`、`db_growth_book_time_topic`、`db_growth_book_task_item`、`db_parent_task_submission.*_book_included` |
| 端点 | 17 条，全实作 | 0 条（G68）＋ 1 条已实作但教师用不上（G70） |
| 页面 | `growth-book`、`growth-book-edit`、`growth-book-section-edit`、`growth-book-section-materials`、`growth-book-view`、`growth-book-sample` | `growth-book-time-manage`、`growth-book-task-manage`、`home-school-moment-feed` 的勾选 |

交接文档把成长册 9 页整体记为「阻于 G68」（`docs/handoff/2026-09-08-…` 第 246 行）。
按上表，G68 直接挡的是 9 页里的 2 页加 1 个勾选。其余 6 页的端点都有 handler。
但 `growth-book-edit` 的「锁定编册」前置之一是「每项在园活动恰好归一个主题」
（`action-registry.tsv` 第 50 行 `every_growth_material_has_exactly_one_topic`），
这一项要靠 G68 的端点才能在客户端事先判断 —— 所以锁定那一步会被 G68 间接挡住，
其余动作不会。

## 4. DDL 落地

八张表在 `db/01_schema.sql` 里全部有 `CREATE TABLE`。行数从 `STATS.md` 抄出，
并在 `hualong_test` 库里 `count(*)` 复核，逐表相同。

| 表 | 是什么 | `CREATE TABLE` 行号 | STATS.md 行数 | 库里实测 |
|---|---|---|---|---|
| `db_growth_book_compilation` | 一班一学期一份编册（栏目开关、e1／e2） | 1596 | 12 | 12 |
| `db_growth_book_time_topic` | 编册里在园时光的主题 | 1628 | 36 | 36 |
| `db_growth_book_section` | 教师新增的栏目（d1／d2，c1／c2） | 1647 | 12 | 12 |
| `db_book_widget` | 新增栏目版面上的一个 widget，一 widget 一列 | 1678 | 48 | 48 |
| `db_growth_material` | 在园时光／社区投稿进编册的登记（G68 的表） | 1714 | 138 | 138 |
| `db_growth_book_task_item` | 编册里亲子活动的收录顺序 | 1749 | 54 | 54 |
| `db_book_material_submission` | 教师征集的栏目素材，家长交上来的一槽一幼儿 | 1767 | 157 | 157 |
| `db_growth_book` | 一名幼儿一学期一本册（b1／b2） | 1798 | 120 | 120 |

相关但未点名的：`db_school_book_release` 1 行（#13 建册要它）、
`db_school_book_template_assignment` 6 行、`db_notification` 1203 行（#12、#15 会往里写）、
`db_parent_task_submission.parent_book_included`／`teacher_book_included` 两列在第 1149–1150 行。

class_id 1 的现状：2 份编册（`compilation_id` 1 是 2025-2026-1、e2；2 是 2025-2026-2、e1），
10 名在读幼儿，20 本册（10 本 b2、10 本 b1）。

## 5. 接之前要处置的两条实作漂移

### 5.1 `POST /teacher/growth-book/compilation` 已存在时回 409，契约说幂等取回

契约（`openapi.yaml:1749`）：「`UNIQUE(class_id, term_id)`，所以本端点是幂等的取回或建立」。
实作（`teacher-book.mjs:79–87`）：`INSERT … ON CONFLICT (class_id, term_id) DO NOTHING RETURNING …`，
冲突时 `RETURNING` 回不到行，随即 `fail('state_precondition_failed', rule: 'one_compilation_per_class_term')`。

后果：class 1 本学期（2025-2026-2）已有 `compilation_id` 2（e1）。页面一进来打这一条就是 409，
而契约里**没有** `GET /teacher/growth-book/compilation`，页面拿不到 `compilation_id`，
后面 #2、#3、#5、#13 全部没法带参数。修法是冲突时改为 `SELECT` 已有行回 200（契约的 201／200 二态）。
未实测：打它会在库里建行（换一个没编册的学期时），本次不打。

### 5.2 `GET /teacher/growth-book/precheck` 回包形状漂移

契约 `ClassPrecheck`（`openapi.yaml` schemas）与 `teacher-book.mjs:340` 的实作对不上：

| | 契约 | 实作 |
|---|---|---|
| 顶层 | `{ content_fingerprint, children[] }` | `{ items[], next_cursor }` |
| 每行必填 | `child_id, total_pages, book_status, publishable` | `child_id, child_name, growth_book_id, book_status, required_slots, filled_slots, complete, issues` |
| 问题码 | `problems[].rule`（如 `collected_incomplete`）＋ `section_key` | `issues[].field='collected_slots', rule='incomplete'` |
| 指纹 | 必回，定稿时带回，漂移回 409 | 不回；#15 定稿实作也不读 |
| 每名幼儿几行 | 一行 | **两行**（SQL 按 `child_id + class_id` LEFT JOIN `db_growth_book`，没按 compilation／term 过滤；class 1 有两个学期的册，10 名幼儿回 20 行） |

这两条都**不是** G68。它们是「契约有、实作也有、但两边说的不是同一件事」，
按 `CLAUDE.md` §2 的口径要么修 `teacher-book.mjs`，要么在 `db/GAPS.md` 登记给编号。
接客户端之前要先选一个。
此外 #3、#12、#15 三条契约写「幂等键必填」，服务端只在 `lib/http.mjs:34` 登记了
`idempotency_key_reused` 错误码，无处读 `Idempotency-Key`；这只影响重放语义，
不挡接线，但探针要钉。

## 6. 结论：哪几条现在能接、哪几条要等什么

| 现在就能接（15 条） | 要等什么 |
|---|---|
| #2–#13、#15 共 13 条 | 无。写探针 `probe-growth-book.mjs` 钉状态机（e1→e2 单向、d1→d2 冻结、c2→c1 删行）与范围（别班 section_id 回 404），跑完删自己建的行 |
| #1 compilation | 先修冲突分支回已有行（§5.1）。不修的话页面第一步就 409，拿不到 `compilation_id` |
| #14 precheck | 先定回包形状（§5.2），再接。不定就接，`growth-book` 的检查表会按错的字段渲染 |

| 要等的（2 条） | 等什么 |
|---|---|
| #16 manifest、#17 pages | 第一份 released layout pack（ADR-0015 Follow-ups，现 0/12）。等到之前 `growth-book-view`／`growth-book-sample` 只能接「书在不在范围内」这一层（404／409），页面本体没有数据 |

| 不在 17 条里但同一条线上要等的 | 等什么 |
|---|---|
| `growth-book-time-manage`、`home-school-moment-feed` 的勾选 | G68：为 `db_growth_material`／`db_growth_book_time_topic` 定一族端点 |
| `growth-book-task-manage` | G70（看板行加 `parent_task_submission_id` 或加详情端点）＋ `db_growth_book_task_item` 的端点 |
| `growth-book-edit` 的「锁定编册」 | 动作本身能接，但前置 `every_growth_material_has_exactly_one_topic` 要靠 G68 的端点在客户端预判；不预判就只能等服务端 409 |

接线顺序建议：先 #4 GET sections → #1 POST compilation → #5–#9 栏目版面 →
#10–#12 征集 → #13 建册 → 定 #14 → #15 定稿。在园时光、亲子时光两页留到 G68／G70 之后。
