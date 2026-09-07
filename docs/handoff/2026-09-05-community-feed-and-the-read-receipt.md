# 交接：社区共育三页、契约到 v0.10、以及「已读」终于有了落点

日期：2026-09-05 起，2026-09-07 补完渲染验收带回来的五条修改（§7bis）

> 接在 `2026-09-01-parent-tasks-and-the-eight-hours.md` 之后。那一份的做法仍然有效。
> **这一轮动了 DDL**，是 v0.5 以来第一次，见 §4。新踩的坑在 §7 与 §7bis。

---

## 1. 现状

`miniprogram/` 共 **55 页**，**22 页已接 API**，**33 页仍是写死的字面量**。

| 已接 | 页 | service |
|---|---|---|
| 资源与案例库 | `resource-library`、`resource-detail`、`case-library`、`case-detail`、`upload-resource` | `services/library.js` |
| 党建 | `school-affairs`、`party-study-list/detail`、`party-activity-list/detail`、`party-brand-list/detail` | `services/party.js` |
| 在园时光 | `home-school-moments`、`home-school-moment-feed`、`home-school-moment-publish` | `services/co-education.js` |
| 亲子任务 | `parent-tasks`、`parent-task-detail`、`parent-task-publish` | 同上 |
| **社区与评价** | **`community-coeducation`、`parent-evaluation-detail`、`teacher-monthly-evaluation`、`teacher-monthly-form`** | 同上 |

**四页全部写进 `co-education.js`，没有新建 `services/evaluation.js`。** 上一份交接说它
「就在旁边」—— 它不存在，而且不该存在：这三族的 `tags` 都是 `home-school`，与在园时光、
亲子任务同一个契约模块。`evaluation.js` 是 `assessment` 模块的名字（`/term-evaluations`、
`/child-assessments`），那是另一条线。**CLAUDE.md §4 是「一个契约模块一个文件」，不是
一个页面族一个文件。**

验证口径（都是实跑的数字）：

| 检查 | 命令 | 结果 |
|---|---|---|
| 结构自检 | `npm test` | 6 项全过 |
| 孤儿样式 | `node tools/scan-orphans.mjs` | 无新增 |
| 接口探针 | 七支 `tools/probe-*.mjs` | **501 项断言，0 失败** |
| 越权测试 | `cd /d/hualong-backend/db/testdata && node authz-tests/run.mjs --base …` | **894 次探针，七组全过** |
| 数据集断言 | `psql -f db/testdata/verify.sql` | **20 个断言块全部 0 行违规** |
| 后端 harness | `node db/tools/check-all.mjs` | **8 项全过** |
| 渲染 | 开发者工具里真点 | **只验过两处**，其余未验（§8） |

单支探针：session 8、library 47、library-write 20、party 64、moments 73、
parent-task 120、**coeducation 169**（本轮新增）。

---

## 2. 这一轮做了什么

分两段。第一段是计划内的「修 G71 + 接 3 页读」；第二段是使用者看过渲染之后追加的
四件事，比第一段重。

### 2.1 第一段：G71 只是十三分之一

计划是「修 G71（社区共育 feed 回错实体），一轮能完」。实测下来**实作与契约不符共 13 处**，
G71 只是其中一条。全部用真 HTTP 复现过，随后由 `probe-coeducation.mjs` 接管。

`/home-school/community-feed` **五处**：

| # | 症状 | 后果 |
|---|---|---|
| 1 | 回 `db_parent_task` 的行 | **G71 本体**，整页会照「任务列表」写出来 |
| 2 | 范围只筛 `school_id` | 契约要 `class_id = $ctx_class`。1 班教师回包第一条是 6 班的，**看得见别班家长写的正文与孩子照片** |
| 3 | 硬编码 `t2`，忽略 `parent_task_type` | 「日常任务」筛选是死的 |
| 4 | 完全忽略 `time_window` | 「本周／本月／更早」三个选项全是死的 |
| 5 | 排序键 `published_at DESC` | 契约写 `submitted_at DESC, parent_task_submission_id DESC` |

`/home-school/parent-evaluations` **四处**：不回契约必填的 `completion`（折算明写在服务端做）、
回 schema 里没有的 `evaluation_title`、排序键错、**忽略分页**（发 `limit=3` 回 90 条）。

`/home-school/month-evals` **四处**：回 schema 里没有的 `child_name`、不回 `file_id`、
排序两列顺序反了、同样忽略分页。

第 2 条最值得记：**范围搞错不会报错，只会静默多回一些行。** 契约的 `x-hualong-scope`
是唯一写着「该看到什么」的地方，实作偏离它没有任何东西会响 —— 除非探针两头钉。

### 2.2 第二段：使用者看过渲染之后追加的四件事

**（a）「已读」有落点了 —— F24，本轮最重的一件。**

使用者的原话：「假如家长端已经点开了消息，那么就要记录这个亲子任务已经被读了，
**只是没有完成而已**」。

原型的教师端有两处「已读」列，全库一直没有落点，前两轮接页面时都不渲染并登记进 G70。
现在加了两列 `read_at`，**不新增表**（亲子任务发布时本来就按名册预建提交行，
那行在家长交作业之前就存在）。三条口径见 §4。

教师看板因此从两档变**四档**：未读 / **已读未完成** / 审核中 / 已完成。
中间那一档就是这一列的全部价值。

**（b）月评的月份列改按学期算。** 使用者：「不需要 7 个月，只要本学期（不包括假期）」。
规则定成**盖满整个自然月才算**，本学期 `2026-02-23`→`2026-07-10` = 3／4／5／6 **四列**。

**（c）月评填写页接真接口。** 此前堵在 G51（`e1`／`e2` 分界没人定），使用者拍板
「草稿一直是 `e1`」，写成 F25，解除契约上的阻断。

**（d）教师读得到家长评价的正文 —— G73 的解。** 新增
`GET /home-school/parent-evaluations/{id}`，点某一行弹层显示。

---

## 3. 契约从 v0.8 走到 v0.10

两次修订，理由全文在 `hualong-backend/docs/API-CONTRACT.md` §15。

| 计数项 | v0.8 | v0.9 | v0.10 |
|---|---|---|---|
| paths | 125 | 125 | **128** |
| operations | 150 | 150 | **153** |
| schemas | 135 | 137 | **139** |
| 动作数 | 123 | 123 | **126** |
| 缺口条目 | 71 | 73 | **73**（开放 43） |
| 表数 | 62 | 62 | **62** |
| BLOCKER | 8 | 8 | **8** |

v0.9 加的两个 schema 是 `ParentTaskSubmissionFeedRow` 与 `MonthEvalBoardRow`，
理由同一条：**契约声明的实体行不够渲染一张卡片／一张表**。
`ParentTaskSubmission` 只有 `child_id`，没有姓名，也不带任务标题与类别；
`MonthEval` 同样只有 `child_id`，而矩阵第一列就是姓名。两者在契约里各有先例
（`ParentEvaluationBoardRow` 带 `child_name`，`EvaluationPhotoSource` 带 `parent_task_title`），
不是新发明的做法。

v0.10 加的两个是 `ReadReceipt` 与 `ParentEvaluationDetail`，三条 path 是两条读回执
加一条教师端评价详情。

---

## 4. 动了 DDL —— 两列 `read_at`

`db/01_schema.sql` 加两列，**表数 62 不变**：

| 列 | 语意 |
|---|---|
| `db_parent_task_submission.read_at` | 这家**首次打开这条亲子任务**的时刻 |
| `db_parent_evaluation.read_at` | 这家**首次打开这份评价**的时刻 |

三条口径（决议 `DECISIONS.md` **F24**）：

1. **任一监护人打开即算**，不区分是谁。与 B1／G3「家庭共用一份」同口径。要区分到人得
   再开一张 N:M 表，而**教师要的是「这家看到了没有」，不是「爸爸看了妈妈没看」**。
2. **首次写一次，永不覆盖**（`read_at IS NULL` 内联在 UPDATE 的 WHERE 里）。
   它回答「消息到达了吗」，不是「最近一次翻看」—— 后者会让这一列随每次翻看漂移。
3. **写它的是显式端点，不是详情 GET 的副作用**：

```
PUT /parent/children/{child_id}/parent-tasks/{parent_task_id}/read-receipt
PUT /parent/children/{child_id}/evaluations/{parent_evaluation_id}/read-receipt
```

第 3 条的理由值得完整记下来，将来一定有人想「在 GET 里顺手写一下就好了」：

- GET 一旦写库就**不再幂等**，预取、重试与任何缓存层都会凭空造出「已读」；
- 本仓库的写入**一律进 `api/action-registry.tsv`**，而登记表按「方法 + 路径 + 状态迁移」
  记账，一个偷偷写库的 GET 没法登记，等于绕过整套账；
- **「渲染了」与「人看到了」不是一回事**。客户端自己决定何时算读到（例如详情真正出现在
  屏幕上），比服务端猜要准。

`PUT` 而非 `POST`：首次写一次、之后是空操作，天然幂等，没有请求体。

### 合规面，写在明处

这是一次**新的行为数据采集**，记录一个自然人何时打开了什么，属个人信息，适用最小必要
（PIPL 第六条）与告知义务（第十七条）。**它不是敏感个人信息**（不涉医疗、生物识别、
行踪轨迹），不触发第二十八条 —— 与 G27 拔掉身高体重不是一个量级。

三件事要有人接着做：

1. **告知文本里要写上这一项**，留存期跟 F23 的资料留存期走；
2. **家长端要说明教师看得见自己读没读**。不做隐身查看 —— 那等于让这一列说谎；
3. 家长端两个客户端**目前只有原型**，这两条 PUT 短期内没有真实调用方。教师端会读到
   一整列 `NULL`，页面必须把它渲染成**未读**而不是错误。（已经这样写了。）

---

## 5. 三条决议

| 编号 | 是什么 |
|---|---|
| **F24** | 已读回执：两列 `read_at`、家长端显式 PUT、任一监护人算、首次写不覆盖 |
| **F25** | 月评草稿一直是 `e1`，`e2` 作废，`saved_at` 在发布那一步写（**解 G51**） |
| — | G73 由新增的教师端详情端点解掉（不是决议，是补了一条端点） |

F25 定 `saved_at` 落发布的理由是它唯一的消费者 —— 家长端报告上那个日期（F11／Q60-i、j）。
**家长该看到的是这份评价发布的日子**，不是教师某次改稿的日子；落在保存那一步，
教师发布前多存两次，家长看到的日期就往前漂，而那个日期对家长没有意义。

`e2` 按 **G69** 的先例**不动 CHECK**：既有 10 笔旧数据仍读得到、照常渲染，新写入不再产生它。
对外口径本来就是二元（`e3` 已完成，其余未完成），留着不影响任何读法。

---

## 6. 缺口账

**已解／已修 3 条**：

- **G71** `community-feed` 回错实体 —— 已修，连带修掉范围、两个筛选、排序共 5 处。
- **G51** 月评 `e1`／`e2` 分界 —— 由 F25 解。
- **G73** 教师读不到家长评价正文 —— 由新端点解（本轮**登记当天就修掉**）。

**新登记 2 条**：

- **G72** `ParentTaskSubmission.file_id`「处理后图片」挂在哪个 `usage_key` 下**没人定过**。
  用途表里与本表相关的只有 `book_parent`／`book_teacher`，两个都是**进册选择**、不是原始附件。
  数据集印证：322 行引用全是 `book_parent`，而 `c1` 提交有 431 笔、进册的只有 135 笔，
  **三个数两两对不上**。本轮取图时不筛 `usage_key`，代价是把「原始附件」与「家长的进册选择」
  读成了同一件事。连带影响 `TeacherBookInclusionWrite.file_id` 那条「必须是已冻结附件的子集」——
  子集的母集合正是本条说不清的东西。
- ~~G73~~ 当天就修掉了，仍留在 GAPS.md 里标已修。

**G70 只解掉一半**：「已读」那一半由 F24 解，**「教师读不到亲子任务提交的正文与照片」
仍然开着** —— 那要的是另一条端点，本轮没做。

缺口条目 71 → 73，**开放 45 → 43**，BLOCKER 仍是 8。

---

## 7. 本轮新踩的坑

### 7.1 契约声明的实体行，不一定够渲染一张卡片

G71 说的是「实体搞反了」。修实作时才发现契约那一侧也不够用：`ParentTaskSubmission`
只有 `child_id`，卡片的头部（谁交的）、类别标签、进册按钮的状态全都渲染不出来。

**这一类问题在「修实作」阶段才暴露，不在「读契约」阶段。** 判断方法：拿契约的行形状
逐字段对一遍原型的那张卡片，缺哪个字段就是缺哪个。三条出路（加字段／不显示／客户端
再拉一次关联）里，第三条在分页之后关联不上 —— 这一页的投稿可能属于上一页没取到的任务。

### 7.2 排序键方向不一致时，游标不能写成元组比较

月评的排序键是 `eval_month DESC, child_id ASC`，**两列方向相反**。
`(a, b) < (x, y)` 这种元组比较**只在两列同向时**等价于「排在后面」，混向时是错的。
展开成两段写：

```sql
AND (m.eval_month < $5 OR (m.eval_month = $5 AND m.child_id > $6))
```

这个错不会报错，只会在翻第二页时静默漏行或重复。

### 7.3 参数个数必须固定，哪怕某个分支用不到

社区共育的 `time_window` 缺席时我原本写成 `AND TRUE`，于是 `$4`（园所今天）在那条分支上
从未被引用 —— PostgreSQL 当场拒绝，回 `internal_error`。改成一句恒真但**引用到 $4** 的
predicate：

```sql
AND ${TIME_WINDOWS[window] ?? '$4::date IS NOT NULL'}
```

### 7.4 探针要验它自己会红

`probe-coeducation.mjs` 第一次跑就 96 项全绿 —— 因为我是在**改完实作之后**写的它。
全绿的探针有两种可能：实作是对的，或者断言是恒真的。**分辨方法是让它红一次**：

```bash
cd /d/hualong-backend && git stash push db/testdata/server/routes/teacher.mjs
# 重启服务端，跑探针 → 24 项失败
git stash pop
```

**24 项失败**才证明它是回归测试，不是一组自我肯定。这一步花了三分钟，值得每次都做。

### 7.5 改数据集的生成器时，不要消耗随机流

给 `read_at` 造数据时，最自然的写法是 `r.chance(0.5)`。**那会挪动整个随机流**，
让这一列之后的每一个随机值全部改变 —— `testdata.sql` 会整份变，`STATS.md` 的逐表行数
可能跟着变，而你根本分不清哪些是本次改动、哪些是流位移。

改用**不消耗 RNG 的确定式**（`child_id % 2 === 0`）。结果：`testdata.sql` 只有那两张表的
1062 行变了，`STATS.md` 一个数都没动。

### 7.6 后台起的服务端会随 shell 退出被回收

`nohup node server/server.mjs &` 在一次 Bash 调用里起的进程，**调用结束就没了**。
使用者在开发者工具里因此撞到 `ERR_CONNECTION_REFUSED`，而页面代码是对的。

排查顺序：先 `curl -s -o /dev/null -w "%{http_code}" http://localhost:3860/api/v1/auth/session`，
**401 才是活的，000 是没在跑**。

### 7.7 数据集会被手工试探污染

我用 `curl` 手工验读回执时，把一行的 `read_at` 从 `NULL` 改成了真值，事后忘了还原 ——
1 班的「已读未完成」从 8 变成 9。**探针会收拾自己建的行，手工 curl 不会。**
用原始 HTTP 试写入之后，立刻把那一行还原，或者记下来一起清。

---

## 7bis. 渲染验收带回来的五条修改（2026-09-07）

使用者在开发者工具里点过之后提了五条。全部改完，探针从 475 涨到 **501 项断言，0 失败**。

**（1）相册照片点选没有「✔」。** 根因是我加的 `<image>` 是**静态定位并撑满格子**，
把绝对定位的勾选标记盖住了。改成图片绝对定位垫底 + 勾选标记 `z-index: 2`，
并加一层半透明蒙版 —— 照片本身花花绿绿，只靠一圈边框看不出选中。
`.imported .remove` 同批抬层级，同一个原因。

**（2）「发布家长测评」的汇总与点进去对不上。** 使用者看到列表写「23/28 已提交」，
点进去却是全都未读未完成。

**两个独立的毛病**：

- `parent-evaluation-publish`（发布家长测评）**整页是写死的假数据**，`23/28` 是字面量。
  它一直在未接 API 的名单里，而我上一轮没意识到使用者会拿它跟接好的那一页对照。
- `onHistoryTap` **不带任何参数**就跳走，所以测评进度页只能显示「最近动过的那一期」——
  数据集里那是学期评价（全班都还没填）。列表点 6 月、进去看到学期评价，数字自然对不上。

**这是一类值得记住的错**：接一页而不接它的上游，两页放在一起看就会互相矛盾，
而**每一页单独看都是对的**，探针也全绿。判断方法：接完一页，问「谁会跳到它、谁会从它跳走」，
那些页显示的同一组数字对得上吗。

已修：历史列表接 `GET /home-school/parent-evaluations`，经新增的 `parentEvalPeriods()`
按 `evaluation_type + evaluation_period` 折成一组一行；点某一期带 `type` 与 `period`
两个参数过去，测评进度页显示那一期（没带参数时仍退回最近动过的一期）。

**每组的分母是那一组真实的行数，不是班级人数** —— 中途转入的幼儿可能没有上个月那一份，
写死班级人数会让分母比分子大得莫名其妙。

**「发布给家长」按钮仍接不了**（`POST /home-school/parent-evaluations` 回 501，堵在 G50）。
**没有在客户端预先拦下**，仍然真发这一请求，失败后弹窗照实说明原因 —— G50 拍板后这一页
不用改就能用；本地拦下的话，那天没人会记得回来把拦截删掉。

`parent-evaluation-publish` 因此算**半接**：读是真的，写堵着。**页数仍算 22**，
它不进「已接」那张表。

**（3）任务详情的时间不必到分钟。** 详情页改成只显示到日。
`utils/time.js` 新增 `formatFullDay()`（`2026-04-13`）—— 既有的 `formatDay()` 回 `04-13`
**不带年**，而亲子任务可以属于上学期，翻旧任务时分不出是哪一年。

**只改了显示，没改存储**：`start_at` 在库里仍是完整时刻（`TIMESTAMP`，且在 §1.2 的
计划时刻白名单上），发布任务的表单也仍然让教师挑到分钟。**要不要把表单的时间选择器
也简化成只挑日期，是一个没问的决定** —— 截止时间是「6月10日 21:00」还是「00:00」，
对家长有实际区别。

**（4）提交情况改三列。** 幼儿 / 已读 / 完成情况，提交时间那一列删掉。

**连带把「已读未完成」这个复合词拆掉了。** 上一轮的四档写法（未读／已读未完成／审核中／
已完成）**把两个维度压成了一个枚举**，多一种状态就要多造一个词。现在是两个独立的列：
`readLabel`／`readTone`（已读／未读）与 `doneLabel`／`doneTone`（已完成／未完成／审核中）。
`stateLabel`／`stateTone` 从看板行上删掉了，探针里那两条断言同批改。

**（5）两个入口卡片颜色与旁边不一致。** `growth-record` 的「发布家长评价」与
`teacher-evaluation` 的「月度评价」带着 `primary: true`，样式是绿底绿字。
两处的 `--primary` 规则、wxml 的 class 绑定、data 里的标记一起删掉（§5.5）。
**这一条使用者已经验过，颜色一致了。**

---

## 8. 没做的

- **渲染只验了一条。** 使用者确认了 §7bis（5）的卡片颜色。其余**一次都没被人眼看过**：
  `teacher-monthly-form`（整页重写，风险最高）、`parent-evaluation-detail` 的底部弹层与
  三列表格、`teacher-monthly-evaluation` 的 4 列动态网格、`parent-task-detail` 的三列表格，
  以及 §7bis（1）(2)(3)(4) 那四条改动本身。
- **发布任务表单的时间选择器仍到分钟**，见 §7bis（3）。要不要简化是一个待问的决定。
- **两个仓库都没提交、没推。** 前端 17 项、后端 16 项。推的时候**先推后端** ——
  线上 Swagger 跟的是后端 remote，只推前端会看起来像「改了却没生效」（CLAUDE.md §2）。
- **G72 的处理是折中，不是修好。** 要真修得先定一个 `usage_key`，再改灌库脚本与家长端写入路径。
- **G70 的另一半仍开着**：教师读不到亲子任务提交的正文与照片。与本轮解掉的 G73 是同一类，
  修法也同一类（补一条教师端详情端点）。
- **家长端的两条读回执没有真实调用方**，那两个仓库现在只有原型。
- **`parent-evaluation-publish` 仍接不了**，`POST /home-school/parent-evaluations` 回 501，
  堵在 **G50**（一次开窗为哪些幼儿建行，没人定过）。
- **两个页面内题库仍是三份**，使用者明确说这一轮不动。

---

## 9. 下一条线：三条候选都核对过了

上一份交接说的端点数，这次真去查了服务端的 handler：

| 线 | 页数 | 端点 | 拦路的东西 |
|---|---|---|---|
| **教研培训** | 6 | 6 条路径 / 7 个 handler，**全实作** | 无 |
| **综合协调** | 2 | 2 条，全实作 | 无 |
| **教师档案** | 2 | 2 条路径 / 3 个 handler，全实作 | 无 |
| 待办任务 | 2 | — | **G62 未定**：`db_task` 是状态机还是投影 |
| 成长册 | 9 | 18 条 | G68 剩下的部分 + 本地存储去留 |
| 评价与评估 | ~7 | 9 条 | 两个题库怎么处理 |
| `teacher-message` | 2 | **契约里没有 `/notifications`** | 接不了 |
| `home` | 1 | 没有聚合端点 | 留到最后 |

**整个薄服务端现在只剩 2 条 `not_implemented`**：`POST /home-school/parent-evaluations`（G50）
与一条管理端转班。本轮关掉了月评草稿那条。

推荐 **教研培训 6 页**：无 blocker、页数最多，接完到 28/55。

---

## 10. 环境

```bash
# PostgreSQL 本地 5432，库名 hualong_test
cd /d/hualong-backend/db/testdata
node server/server.mjs          # → http://localhost:3860/api/v1
```

`psql` 不在 PATH 上，在 `/c/Program Files/PostgreSQL/17/bin/`。重灌数据集：

```bash
export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
export PGPASSWORD=postgres
cd /d/hualong-backend
node db/testdata/generate.mjs
psql -U postgres -h localhost -d hualong_test -q -f db/01_schema.sql
psql -U postgres -h localhost -d hualong_test -q -f db/testdata/testdata.sql
psql -U postgres -h localhost -d hualong_test -q -f db/testdata/verify.sql   # 20 块，全 0 行
```

基准日 `2026-04-25`，当前学期 `2025-2026-2`（`2026-02-23`→`2026-07-10`，整月覆盖 3/4/5/6），
上学期 `2025-2026-1`（`2025-09-01`→`2026-01-16`，整月覆盖 9/10/11/12）。

换用户：改 `miniprogram/config.js` 的 `devSubjectId`。1–12 在职，**13 已离职，登录会失败**。

**1 班的三档基线**（`read_at` 相关的断言全钉在这三个数上）：

| 档 | 笔数 |
|---|---|
| 已完成 | 76 |
| **已读未完成** | **8** |
| 未读未完成 | 6 |

三档任何一档为空，探针里那些断言都可能是空过 —— 所以 `probe-coeducation.mjs` 专门有一条
断言在验「三档都非空」。
