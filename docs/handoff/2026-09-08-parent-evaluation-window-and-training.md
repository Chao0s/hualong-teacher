# 交接：家长评价开窗解锁、教研培训三页，以及一个反复没修好的勾选标记

日期：2026-09-07 至 2026-09-08

前端 `D:\hualong-teacher` 分支 `master` → **`d01f74d`，已推**
后端 `D:\hualong-backend` 分支 `main` → **`2cfa950`，已推**

> 接在 `2026-09-05-community-feed-and-the-read-receipt.md` 之后。那一份的做法仍然有效。
> 新踩的坑在 §6，其中 §6.1 与 §6.2 是这一轮最值得记住的两条。

---

## 1. 现状

`miniprogram/` 共 **55 页**，**26 页已接 API**，**29 页仍是写死的字面量**。

| 已接 | 页 | service |
|---|---|---|
| 资源与案例库 | `resource-library`、`resource-detail`、`case-library`、`case-detail`、`upload-resource` | `services/library.js` |
| 党建 | `school-affairs`、`party-study-list/detail`、`party-activity-list/detail`、`party-brand-list/detail` | `services/party.js` |
| 在园时光 | `home-school-moments`、`home-school-moment-feed`、`home-school-moment-publish` | `services/co-education.js` |
| 亲子任务 | `parent-tasks`、`parent-task-detail`、`parent-task-publish` | 同上 |
| 社区与评价 | `community-coeducation`、`parent-evaluation-detail`、`teacher-monthly-evaluation`、`teacher-monthly-form` | 同上 |
| **家长评价开窗** | **`parent-evaluation-publish`** | 同上 |
| **教研培训** | **`training-list`、`training-detail`、`my-training`** | **`services/training.js`** |

验证口径（都是实跑的数字）：

| 检查 | 命令 | 结果 |
|---|---|---|
| 结构自检 | `npm test` | **7 项全过**（新增第 7 项，见 §4） |
| 孤儿样式 | `node tools/scan-orphans.mjs` | 无新增 |
| 接口探针 | 八支 `tools/probe-*.mjs` | **624 项断言，0 失败** |
| 越权测试 | `cd /d/hualong-backend/db/testdata && node authz-tests/run.mjs --base …` | **894 次探针，七组全过** |
| 数据集断言 | `psql -f db/testdata/verify.sql` | 20 个断言块全部 0 行违规 |
| 后端 harness | `node db/tools/check-all.mjs` | 8 项全过 |
| 渲染 | 开发者工具里真点 | **教研培训三页未验**（§7） |

单支探针：session 8、library 47、library-write 20、party 64、moments 73、
parent-task 120、coeducation 191、**training 101**（本轮新增）。

**薄服务端现在只剩 1 条 `not_implemented`**（管理端转班）。

---

## 2. 这一轮做了什么

### 2.1 G50 解掉 —— 发起家长评价（F26）

`db_parent_evaluation` 的唯一键是**一名幼儿一个周期一行**，所以「发起一次评价」必然是
一次建一批行。这批是谁一直没有决议：`p0` 没有生产者，端点标着 `blocked-on` 回 501，
家长侧那三个已登记动作在运行时无行可操作。

**已定：全班 fan-out** —— 发起当下 `class_id = $ctx_class` 且 `enrollment_status='e1'`
的全部幼儿。三条连带的一并定了，理由都写在 `DECISIONS.md` F26，这里只留最要紧的一条：

**不要名册指纹，与教师寄语（规则 82）分道。** 寄语要它是因为教师**逐幼儿写了 N 段正文**，
漂移会让某一段落空；开窗只有**一份共同的 prompt**，漂移仅仅是多一行少一行。
判定内联在 INSERT 的 `SELECT` 上就够了 —— 契约本来就禁止 read-then-write。
**照抄一条规则之前，先问它当初是为了防什么。**

### 2.2 教研培训三页 + 16 处实作不符

契约 6 条端点全部已实作，但**与契约不符 16 处**。最重的一处：
**重复报名回 409，而契约要求幂等回 200 unchanged** —— 教师连点两下不该看到错误弹窗。

其余按端点分：列表 6 处、详情 5 处、取消 2 处、我的研修 3 处、回馈流 3 处。
逐条写在后端提交 `2cfa950` 的说明里，不在这里重复。两处值得单独记：

- **详情该写的 `viewed` 事件不写**（规则 21）。**只看回包永远发现不了** ——
  探针必须去查 `db_content_access_event` 多没多一行。
- **回馈流不验活动是否仍 `s1`**，于是撤回的活动仍把别人的回馈公开出去，
  而 F9 明写撤回后公开流回空、计数 0。

### 2.3 数据集加了一场未来的研修

原来 8 场按 `2025-09-25 + i*26 天` 排，最晚一场也在基准日 2026-04-25 之前 ——
报名、取消、恢复报名三条路径**在真实数据上一条都跑不通**，教师端那个报名按钮
也永远不显示。加第 9 场（2026-05-12，教师 1 刻意没有报名行），
`STATS.md` 三个数跟着改。

### 2.4 一批渲染问题

题库、边框、勾选标记、日期选择器 —— 见 §4 与 §6。

---

## 3. 契约到 v0.11

| 计数项 | v0.10 | v0.11 |
|---|---|---|
| paths / operations / schemas | 128 / 153 / 139 | **不变**（只改既有 schema 的描述与 `$ref`） |
| 动作数 | 126 | **127**（`parent_evaluation.open_window`） |
| 缺口条目 | 73 | **73**，G50 转已解，**开放 43 → 42** |
| 表数 | 62 | 不变 |
| BLOCKER | 8 | 不变 |

同批修掉 `ParentEvaluationWindowWrite.start_at` 的描述 —— 它还写着「格式待 §1.2 修订」，
而 §1.2 在 2026-08-20 就修完了。**这是 v0.8 修过的那处遗留的最后一个。**

---

## 4. 题库：删不掉就装闸门

使用者要「必要的简化」。原本设想是「让页面从 `data/guide-scale.json` 读，删掉抄本」——
**做不到**：那份 JSON 在 `miniprogram/` 之外，小程序打不进包，页面 `require` 不到。

所以改成按 §7.3 的原则处理：**删不掉就让它漂开时当场失败。**
`npm test` 新增**第 7 段**，逐题比对 124 题的提问与三档锚点。
改一个字验证过它真的会红（报 `H1-1-1 的提问与权威不同`），还原后恢复绿。

**另外那两份根本不是同一套量表**：`assessment-data.js` 是**办园质量评估** 120 题
（评幼儿园／班级／教师），`questions.js` 是**《指南》教师评定量表** 124 题（评幼儿）。
两者曾共用一张表，那是个错误（后端 G5）。所以「三份」其实是
**两份不同的东西 + 一份重复**，只有后者能清。

第三份在后端（`db/rubric/guide-scale-v1.json`），三份内容目前逐字相同，
但后端那份**没有进这个闸门** —— 跨仓库比对要先解决「两个仓库各在什么版本」。

---

## 5. 缺口账

**已解 1 条**：G50 由 F26 解（全班 fan-out）。

缺口条目 **73 不变**，开放 **43 → 42**，BLOCKER 仍是 8。

仍然开着、且会挡下一条线的：

| 编号 | 是什么 | 挡住谁 |
|---|---|---|
| **G62** | `db_task` 是状态机还是投影，没人定过 | 待办任务 2 页 |
| **G68** | 成长册的入册通道有表有数据、零 API 面 | 成长册 9 页 |
| **G70** | 教师读不到亲子任务提交的正文与照片（「已读」那一半已由 F24 解） | 亲子任务的提交预览 |
| **G72** | 家长提交的原始附件没有约定 `usage_key` | 社区共育的照片语意 |
| G5 / G15 / G27 | 五维分数无处存、量表无模板表、身高体重题无评分规则 | 题库改成从接口取 |

---

## 6. 本轮新踩的坑

### 6.1 模板里不要写方法调用 —— 三次改样式都没修好的那个勾选标记

**症状**：相册里点一张照片，勾选标记不出现。

我改了三次样式（层级、蒙版、把 `wx:if` 换成 class 切显隐），全没修好。
第四次才定位到 —— 靠的不是读代码，是**问使用者一个能把范围切开的问题**：

> 点一下之后，底部那个「确定（N）」的数字变吗？格子边框变绿吗？

答案是「数字变了，边框没变绿」。这一句同时排除了两件事：点击到达了、数据更新了；
而**边框与勾选标记读的是同一个判断**，所以一起失效。病根不在样式。

```wxml
class="album-photo {{picked.indexOf(item.fileId) > -1 ? 'album-photo--sel' : ''}}"
```

**`indexOf` 这个表达式在真机上算不出来**，恒为 false。而底部计数读的是
`picked.length`，跟它无关，所以照常在变 —— 于是整件事看起来像样式问题。

我第一次的判断是「嵌套 `wx:for` 的作用域问题」，**那也是错的**：
在园时光 feed 那一页是**扁平**循环，一样坏。共同因素只有 `indexOf`。

**定下来的做法**：所有判断在 JS 里做完，把结果写进每一行数据（`sel` 布尔），
模板只读属性；定位用**下标**（`data-i` / `data-gi`+`data-pi`），不经 dataset 取值转换。
这也更合规矩 —— CLAUDE.md §4 说页面里不判状态，模板里更不该。

**教训有两条**：

1. **模板里不写方法调用。** 直读属性、三元、比较都没问题，`indexOf`／`includes`／
   `filter` 之类不要写。
2. **猜了两次还没中，就别猜第三次。** 设计一个能把可能性一刀切开的观察去问，
   比再读一遍代码快得多。

### 6.2 box-sizing 的表里没有原生表单标签

**症状**：五个页面的输入框「边框溢出」。

`app.wxss` 里写的是：

```css
view, text, image { box-sizing: border-box; }
```

**`input`／`textarea`／`picker` 不在里面** —— 它们是原生表单标签，不是 `view`。
于是 `.input`／`.textarea` 那条规则（`width:100%` + `padding` + `border`）
实际宽度是 100% 再加两边，边框整条溢出到卡片外。

这个毛病**一直存在**，只是边框还是 `1rpx`（2 倍屏上 0.5 物理像素）时溢出量小、
看不出来；我把它改成 `2rpx` 之后就明显了。

一处改动修好全库 20 处输入框。**改全局样式之前，先确认它的选择器覆盖了哪些标签。**

### 6.3 探针要收拾到一个绝对基准，不是进场时看到的状态

`probe-training` 原本按「进场时的最大 `content_access_event_id`」删自己写的 viewed 事件。
于是上一次跑若半途出错没收拾干净，**这一次的基准就是含残留的那个数**，
残留一轮轮累积 —— 真的从 142 涨到了 151。

改成删到 `STATS.md` 的行数为止，并在进场时断言基线。连跑两次都回到 142。

**「会改数据库的探针必须自己收拾」还有第二半：收拾到一个绝对基准。**

### 6.4 探针的测试期间会跟真实操作撞车

`probe-coeducation` 原本用 `2026-09` 当开窗的测试期间。而「发布家长测评」那一页
**按园所今天算期间**，2026-09-07 那天使用者在开发者工具里真点了一次发起 ——
两边撞在同一个 `(type, period)` 上，探针的基线断言被人为操作弄红。

改成 `2099-01`／`2099-02`：真实操作产生不了的值。

**副产品**：那次撞车反而证明了 fan-out 端到端是通的（10 行、正确的时刻、只在 1 班）。

### 6.5 CRLF 让字符串替换静默失配

两个仓库的文件行尾不统一。用 Python 做整段替换时，脚本里写的是 `\n`，
文件里是 `\r\n`，`count(a)==1` 直接断在 0 —— 好在有断言，否则会静默不改。

**做整段替换先探行尾**：`nl = '\r\n' if '\r\n' in raw else '\n'`，再用它拼接。

---

## 7. 没做的

- **教研培训三页的渲染一次都没验过。** 列表两区、详情四块的显隐、报名按钮、
  反馈流与那个刚改高的输入框，全部只有探针过、没有人眼过。
- **`training-center`（教研培训部）与 `resource-center`（课程资源）还没接。**
  两个入口页，卡片上的推荐条目仍是写死的。它们能用 `/resources` + `/cases` 换成真的。
- **`course-building`（课程建设）不接，也不该接。** 它是一篇编辑图文（办园理念、
  衣食住行艺五个范畴），契约里没有课程体系端点。
- **家长端的两条读回执仍没有真实调用方**（F24 加的那两条 PUT），那两个仓库只有原型。
- **G72 的处理是折中**：取图时不筛 `usage_key`，把「原始附件」与「家长的进册选择」
  读成了同一件事。
- **后端那份题库没有进第 7 段闸门。**

---

## 8. 下一条线：三条候选

| 线 | 页数 | 端点 | 拦路的东西 |
|---|---|---|---|
| **教研培训第二次** | 2 | `/resources`、`/cases`（**都已接过**） | 无。最省事的一条 |
| **综合协调** | 2 | `/coordination/documents` 2 条，全实作 | 无 |
| **教师档案** | 2 | `/teacher-profile` 2 条路径 3 个 handler，全实作 | 无 |
| 待办任务 | 2 | — | **G62 未定**：`db_task` 是状态机还是投影 |
| 成长册 | 9 | 18 条 | **G68**：入册通道零 API 面 |
| 评价与评估 | ~7 | 9 条 | 题库改成从接口取（G5／G15／G27） |
| `teacher-message` | 2 | **契约里没有 `/notifications`** | 接不了 |
| `home` | 1 | 没有聚合端点 | 留到最后 |

**推荐顺序**：教研培训第二次（2 页，无 blocker，且能顺手验上一轮那三页的渲染）
→ 综合协调 2 页 → 教师档案 2 页。三条做完到 **32/55**。

再往后就只剩要先拍板的了：**G62**（待办任务）、**G68**（成长册）、题库那三条。

---

## 9. 环境

```bash
# PostgreSQL 本地 5432，库名 hualong_test
cd /d/hualong-backend/db/testdata
node server/server.mjs          # → http://localhost:3860/api/v1
```

**在你自己的终端窗口里跑它，别放进 Claude 的后台槽** —— 系统内存紧张时那个槽会被回收，
连着三次被杀过。判断死活：

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3860/api/v1/auth/session
# 401 = 活的，000 = 没在跑
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

**git 代理走 `127.0.0.1:7890`**（2026-09-07 从 7897 改的，已写进全局配置）。
推送顺序**先后端再前端** —— 线上 Swagger 跟的是后端 remote。

基准日 `2026-04-25`，当前学期 `2025-2026-2`（`2026-02-23`→`2026-07-10`，整月覆盖 3/4/5/6）。
换用户改 `miniprogram/config.js` 的 `devSubjectId`；1–12 在职，**13 已离职，登录会失败**。

### 几个探针钉住的基线

| 集合 | 值 |
|---|---|
| 1 班亲子任务三档 | 已完成 76 / **已读未完成 8** / 未读未完成 6 |
| 研修 | 9 场（6 已发布已结束 + **1 未开始** + 1 草稿 + 1 已撤回） |
| 教师 1 在第 9 场 | **没有报名行**（报名要从「无列」这一态测起） |
| `db_content_access_event` | **142**（探针按这个数收敛，不按进场值） |
