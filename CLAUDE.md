# CLAUDE.md — 化龙教师端小程序

本仓库是微信小程序的教师端。后端在**另一个仓库** `hualong-backend`，两者靠一份
OpenAPI 契约连起来。

---

## 1. 怎么跟我说话

**用中文的 ASD-STE100。** 简化技术英语的规则，用在中文上：

| 规则 | 做法 |
|---|---|
| 一句一义 | 一个句子只讲一件事。描述句不超过 20 个字 |
| 一词一义 | 同一样东西自始至终用同一个词。不要为了不重复而换说法 |
| 主动语态 | 写「服务端拒绝这次写入」，不写「这次写入被拒绝」 |
| 指令以动词开头 | 写「打开 config.js」，不写「你需要打开 config.js」 |
| 一句一个否定 | 不要写「不是不能改」 |

**原样保留、不要翻译也不要改写**：代码、文件路径、命令、API 名、错误码、标识符、
状态编码（`s1`／`e2`／`g3` 之类）。

**报结果给数字。** 写「73 项通过，0 项失败」，不写「测试通过了」。写「12 页已接，
40 页未接」，不写「大部分页面已完成」。做不到验证就写「已做完，未验证」。

**先说结论，再说依据。** 我要先知道结果是什么，再知道你怎么得出来的。

### 术语第一次出现要带一句注解

我和同事都记不住这些名字。**每次对话里第一次提到，紧跟一句它是什么。** 名字本身原样
保留，注解写在后面。两类都要注解：

**第一类 · 缺口与决议编号**（`G71`、`F17`、`B12`、`W19`、`Q62-j39`）。注解写它指什么
问题。

```
不要：接那条线之前先修 G71。
要　：接那条线之前先修 G71（社区共育 feed 的实作回任务行，契约声明的是家长投稿行）。
```

**第二类 · schema 名、表名、端点名**（`ParentTaskSubmission`、`db_month_eval`、
`/home-school/community-feed`）。注解要写**哪个模块的哪个功能、谁做的这件事**，不要
只翻译名字。

```
不要：feed 回的是 ParentTaskSubmission。
要　：feed 回的是 ParentTaskSubmission（教师发的亲子任务，家长交上来的那一笔，
      含家长写的正文与照片）。
```

判断注解够不够：**同名的东西在别处还有一个吗？** 有就要写清是哪一个。系统里有两条
「家长提交」，名字像、事情不同：

| 名字 | 是什么 |
|---|---|
| `db_parent_task_submission` | 教师发亲子任务，家长交作业。一条任务对 N 名幼儿 |
| `db_book_material_submission` | 成长册的栏目要素材，教师向家长征集。一个槽位对一名幼儿 |

注解要短，一句话。同一次对话里再提同一个名字，直接用，不用重复注解。表格里的名字
同样适用——用一个独立的列写注解，或者写在同一格的括号里。

状态编码（`s1`／`e2`／`g3` 之类）不在此列。它们的含义写在契约与 DDL 的列注释里，
必要时才展开。

### 写位置就只写现状

记录某样东西**在哪**的时候，直接写它现在在哪。不要写它以前在哪、什么时候搬的、
旧的那份还在不在。

```
不要：utils/ 原本只有成长册的数据模型，service 层接入后新增了 request 与 auth，
      旧的那套已归档到 Archive/20260831/
要　：utils/ —— request（唯一 HTTP 出口）、auth、guard、session、errors、
      derived、time，及成长册与量表的数据模型
```

沿革只写在**记录决策理由的地方**：`decision.md`、`docs/handoff/`、后端的
`DECISIONS.md` 与 `db/GAPS.md`、以及 `API-CONTRACT.md` 的修订记录。那些文件的
用途就是回答「为什么会变成这样」。

README、目录树、文件头注、代码注释里的路径说明，一律只写现状。读的人要的是
「东西在哪」，不是「东西怎么走到这儿的」。

---

## 2. 改了前后端之间的关系，就要更新 API 文档

**这一条是硬要求，不是提醒。**

只要改动落在下面任何一格，`hualong-backend` 的契约与登记表必须在同一轮里一起改：

| 改了什么 | 要同步的文件 |
|---|---|
| 新增／删除／改名端点 | `api/openapi.yaml` |
| 改请求体或响应体的字段 | `api/openapi.yaml` |
| 改状态机（哪个状态能做哪个动作） | `api/openapi.yaml` + `api/action-registry.tsv` + `api/action-coverage.tsv` |
| 改范围规则（derived／scoped／free） | `api/openapi.yaml` + `db/spec/scope-rules.json` |
| 发现契约与实作对不上，但暂时不修 | `db/GAPS.md` 登记一条，给编号 |

改完在 `docs/API-CONTRACT.md` §15 追加一条修订记录，写清楚**为什么**这么改、
**代价**是什么、**计数怎么变**（paths / operations / schemas / 动作数 / 缺口数）。
计数要实测，不要照抄上一条。

然后跑后端仓库的 harness：

```bash
cd ../hualong-backend
node db/tools/check-all.mjs
```

**Swagger 站点不用手工改，也没有一份要同步的副本。** 本仓库只读契约、从不复制一份
（`tools/openapi-source.mjs` 的头注写明了理由：一份复制品会悄悄过期，而过期的契约比
没有契约更糟）。三处各自取一次：

| 哪一份 | 读谁 | 什么时候更新 |
|---|---|---|
| `npm run swagger`（本机看） | 每次请求现读 `../hualong-backend/api/openapi.yaml` | 改完契约存盘即生效，刷新页面就有 |
| `npm run docs:api`（生成静态站） | 同上，写到 `dist/`（已 gitignore，**产物从不提交**） | 手动跑才生成 |
| GitHub Pages 上那份 | CI 从 **GitHub 上的 `hualong-backend`** 现 checkout | 推前端 master，或后端触发 `contract-changed` |

**所以线上那份跟的是后端 remote，不是本机。** 契约改完只提交在本地时，线上仍是旧的；
只推前端也不行 —— CI 会重建，但它 checkout 的后端 remote 还是旧 HEAD，站点照样是旧的，
看起来像「我明明改了却没生效」。**要先推后端。**

### 顺序不能反

薄契约服务端的**路由表是从契约生成的**。所以顺序永远是：

1. 先改 `api/openapi.yaml`
2. 再改服务端实作
3. 最后改客户端

跳过第 1 步，服务端会回 `501`，而且「漏实作」与「不存在」在外面看起来一模一样。

---

## 3. 现状

`miniprogram/` 共 **55 页**，**26 页已接 API**，**29 页仍是写死的字面量**。

判断某一页属于哪一类：看 `index.js` 里有没有 `require('../../services/`。
在开发者工具里看 Network 面板有没有 `/api/v1/...` 请求，是同一件事的另一种查法。

| 已接 | 页 |
|---|---|
| 资源与案例库 | `resource-library`、`resource-detail`、`case-library`、`case-detail`、`upload-resource` |
| 党建 | `school-affairs`、`party-study-list/detail`、`party-activity-list/detail`、`party-brand-list/detail` |
| 在园时光 | `home-school-moments`、`home-school-moment-feed`、`home-school-moment-publish` |
| 亲子任务 | `parent-tasks`、`parent-task-detail`、`parent-task-publish` |
| 社区与评价 | `community-coeducation`、`parent-evaluation-detail`、`teacher-monthly-evaluation`、`teacher-monthly-form` |
| 家长评价开窗 | `parent-evaluation-publish` |
| 教研培训 | `training-list`、`training-detail`、`my-training` |

### 提到页面就写它在屏幕上叫什么、怎么走到

**目录名我对不上屏幕。** `teacher-monthly-form` 是哪一页，光看名字认不出来。

**表格里提到页面，加一列写中文标题与到达路径。** 正文里提到，直接在括号里标：

```
不要：teacher-monthly-form 整页重写，风险最高。
要　：teacher-monthly-form（「填写月度评价」，家园社共育 → 成长档案 → 教师评价
      → 月度评价 → 点任一圆点）整页重写，风险最高。
```

中文标题的权威是各页 `index.json` 的 `navigationBarTitleText`，**不要自己译目录名**。

底部导航五项（`components/hl-tabbar`）：**首页 / 党建管理 / 综合协调 / 教研培训 / 家园社共育**。
所有路径都从这五个之一起步。已接 API 那 22 页的走法：

| 目录名 | 屏幕上叫 | 怎么走到 |
|---|---|---|
| `home` | 首页 | 底部导航「首页」 |
| `school-affairs` | 党建管理部 | 底部导航「党建管理」 |
| `party-study-list` / `-detail` | 党建学习 / 文件预览 | 党建管理 → 党建学习 → 点条目 |
| `party-activity-list` / `-detail` | 党建活动 / 活动介绍 | 党建管理 → 党建活动 → 点条目 |
| `party-brand-list` / `-detail` | 品牌建设 / 图文介绍 | 党建管理 → 品牌建设 → 点条目 |
| `resource-library` / `resource-detail` | 资源库 / 资源详情 | 教研培训 → 课程资源 → 资源库 |
| `case-library` / `case-detail` | 案例库 / 案例详情 | 教研培训 → 课程资源 → 案例库 |
| `upload-resource` | 上传资料 | 首页 → 上传资源 |
| `home-school` | 家园社共育 | 底部导航「家园社共育」 |
| `home-school-moments` | 在园时光 | 家园社共育 → 在园时光 |
| `home-school-moment-feed` | 全部活动 | 在园时光 → 全部活动 |
| `home-school-moment-publish` | 发布活动 | 在园时光 → 发布活动 |
| `parent-tasks` | 亲子任务 | 家园社共育 → 亲子任务 |
| `parent-task-detail` | 任务详情 | 亲子任务 → 点某条已发布的任务 |
| `parent-task-publish` | 发布新任务 | 亲子任务 → 发布新任务（点草稿进来是改草稿） |
| `community-coeducation` | 社区共育 | 家园社共育 → 社区共育 |
| `growth-record` | 儿童成长档案 | 家园社共育 → 成长档案 |
| `parent-evaluation-detail` | 测评进度 | 发布家长测评 → 点某一期 |
| `teacher-evaluation` | 教师评价 | 成长档案 → 教师评价 |
| `teacher-monthly-evaluation` | 教师月度评价 | 教师评价 → 月度评价 |
| `teacher-monthly-form` | 填写月度评价 | 教师月度评价 → 点任一圆点；也可从首页「本月评价」直达 |
| `parent-evaluation-publish` | 发布家长测评 | 成长档案 → 发布家长评价 |
| `training-center` | 教研培训部 | 底部导航「教研培训」（**这一页本身还没接 API**，只是路径上的一站） |
| `training-list` | 教研培训 | 教研培训部 → 教研培训 |
| `training-detail` | 研修详情 | 教研培训 → 点某一场研修 |
| `my-training` | 我的研修 | 教研培训 → 我的研修（「我的档案」那一格） |

**两个「任务详情」重名**：`parent-task-detail`（亲子任务的，家园社共育那条线）与
`teacher-task-detail`（待办任务的，首页那条线）标题逐字相同。提到时必须写目录名。

**新增页面要同时做三件事**：`app.json` 注册、`index.json` 写
`navigationBarTitleText`、后端 `db/spec/screens.tsv` 登记一行（§7.3）。

---

## 4. service 层的写法

一个模块一个文件，页面 `require` service，**页面里不拼 URL、不译枚举、不格式化日期、
不判状态机**。service 返回的每个值都可以直接 `setData`。

```
config.js              环境与 devSubjectId
utils/request.js       唯一的 HTTP 出口。契约 §1–§5 只在这里实现一次
utils/errors.js        §2.4 错误码登记表，ApiError
utils/derived.js       §7.3 derived 键，发出前剥离
utils/session.js       §6.3 会话状态
utils/time.js          §1.2 时间戳。偏移量是字面量，不是换算
utils/auth.js          登录
utils/guard.js         §7.2 角色闸门
services/*.js          一个契约模块一个文件
```

**枚举表只写一份，写在 service 里。** 权威是 `hualong-backend/db/01_schema.sql` 的列
注释与 `db/DATABASE_SPEC.md` §2。页面再抄一份，就是这次要清掉的那种假数据。

**必填字段以 DDL 的 `NOT NULL` 为准。** 不要照契约的 `required`（好几个写入 schema
根本没写 `required`），更不要照表单长什么样——原型的上传表单漏了一个 `NOT NULL` 列，
那张表单在原型里根本提交不成功。

---

## 5. 怎么跑起来

```bash
# 1. PostgreSQL（本地 5432）要在跑
# 2. 薄契约服务端
cd ../hualong-backend/db/testdata
node server/server.mjs          # → http://localhost:3860/api/v1
```

`project.config.json` 与 `project.private.config.json` 里 `urlCheck` 都是 `false`，
开发者工具可以直接打 `http://127.0.0.1`。

**换用户看不同的人看到什么**：改 `miniprogram/config.js` 的 `devSubjectId`，重新编译。
名册写在那个文件的注释里。1–12 在职，**13 罗慧兰已离职，登录会失败**——那是数据集
刻意造的反例，用来验证凭证撤销，不是坏数据。

---

## 6. 怎么验证

| 检查 | 命令 | 查得出什么 |
|---|---|---|
| 结构 | `npm test` | 四件套缺文件、类名落空、`wx:for`+`wx:else` 同节点 |
| 孤儿样式 | `node tools/scan-orphans.mjs` | 本次改动新造成的孤儿（见 §7） |
| 接口 | `node tools/probe-*.mjs` | 路径、字段、枚举、状态机、范围 |
| 接线 | `npm run scan:wiring` | 元素→事件→handler→service→契约哪一环断了；契约有而客户端没调的操作。写到 `docs/audit/wiring-<日期>.md/.json/.html`；审核结论落在 `docs/audit/wiring.allowlist.json`，重扫会带上 |
| 权限 | `cd ../hualong-backend/db/testdata && node authz-tests/run.mjs --base http://localhost:3860/api/v1` | 七组越权探针 |
| **渲染** | **开发者工具里真点** | **上面全部查不出来** |

探针在 `tools/`：`probe-session`、`probe-library`、`probe-library-write`、`probe-party`、
`probe-moments`、`probe-parent-task`、`probe-coeducation`、`probe-training`。它们桩掉 `wx.*` 之后**加载未经修改的发布代码**，所以路径写错、字段
改名、枚举译反都会红。

**先写探针再改页面。** 前三条线都靠这个顺序在改页之前就抓到了真问题：
`resource_access` 是必填、`resource_ids` 不落库、`child_id` 收下即丢。页面改完再测，
问题会混在渲染问题里。

**会改数据库的探针必须自己收拾**：跑完删掉自己建的行，并核对逐表行数回到 `STATS.md`。

---

## 7. 会咬人的地方

### 7.1 `npm test` 的孤儿样式检查有盲点

`tools/verify-miniprogram.js` 第 118–121 行：WXML 里只要出现一处
`class="a {{cond ? 'x' : ''}}"`，**整个文件跳过孤儿规则检查**。所以它报「未被引用的
规则 0 条」不代表真的没有。用 `node tools/scan-orphans.mjs` 补这一刀。

### 7.2 会话在服务端进程内存里，token 在 Storage 里

`server/lib/auth.mjs`：`const SESSIONS = new Map()`，重启即失效。而客户端 token 存在
`wx.setStorageSync`，**跨重启存活**。服务端每重启一次，模拟器里那张票就是死票。

`utils/request.js` 已经处理：401 且 `devSession` 时清票、重签、重放一次。
**改那一段之前先读它的注释**，那里有两个坑：登录过程内部那次 `GET /auth/session`
必须带 `skipAuthRetry`（否则它会 await 当前这次登录，等自己）；登录失败必须清票
（否则 `isLoggedIn()` 从此说谎）。`probe-session.mjs` 是这两条的回归测试，**带超时**——
死锁会红，不会挂住。

### 7.3 契约只能有一份，不要留第二份当备份

后端是本仓库的**兄弟目录** `../hualong-backend`。`tools/openapi-source.mjs` 与
`tools/lib/testdata-path.mjs` 都按 `../hualong-backend` 找它，**不复制一份**。

2026-09-01 撞过一次：当时有**两份**后端克隆，D 盘一份、Google Drive 一份，
候选表把 D 盘排在前面，而 D 盘那份落后两个提交。于是 `npm run spec:inventory`
报的是 v0.6 的 128/153，`npm run docs:api` 在本机生成的也是 v0.6 的站点，
**全程没有任何报错**。候选表里那条备用路径已经删掉：一份复制品不是冗余，
是一次静默过期。**要么只有一份，要么当场失败。**

**线上那份没受影响** —— CI 从 GitHub checkout 后端，碰不到本机这两份克隆。
受影响的只有在这台机器上跑的命令。

判断读到的是哪一份：`node tools/spec-inventory.mjs` 第一行会打印契约文件的绝对路径，
计数应为 **128 paths / 153 operations / 139 schemas**（2026-09-09 实测）。对不上
就是读错了文件。**这三个数每次契约一动就变，写下来的当天就开始过期** —— 它只用来
认「读到的是哪一份」，不要拿它当契约的规模指标。

`node db/tools/check-all.mjs` 现在会重新生成 `db/spec/ui-binding.tsv` 且**行数正确**
（833 行，前后端在同一个盘上、生成器找得到前端了）。但它会刷新 70 行标签文案，
那是生成物的正常更新、不是你的改动，**跑完 `git checkout -- db/spec/`**。

`check-all.mjs` 现在 **8 项全过**。它的 `check-consistency` 一步曾经红过一阵：那一步扫
前端所有 `.html` 与 `.wxml`，问每个文件有没有 `screens.tsv` 的登记行，而登记表只认原型
文件名（`screens/home.html`），不认识 `miniprogram/pages/home/index.wxml`。
2026-09-01 已修：`screens.tsv` 加了 `mp_file` 列，一个屏幕一行、两个定位符。

同一步在 2026-09-08 又红过一次，原因同类：接线扫描器写出的报告
`docs/audit/wiring-<日期>.html` 与它的外壳模板 `tools/lib/wiring-viewer.html` 都是
`.html`，于是被当成「没登记的屏幕」。2026-09-09 已修：`check-consistency.mjs` 的
`NOT_A_PAGE` 加上 `audit` 与 `tools` 两个目录名。**排除的数目照旧打印出来**
（现为 4 个），静默跳过与静默截短是同一种毛病。

**本仓库的目录名因此进了后端的检查逻辑**，改动这三处要留意：

| 目录 | 后端怎么看它 |
|---|---|
| `miniprogram/pages/<名>/index.wxml` | `screens.tsv` 的 `mp_file` 逐行指着它。**新增页面要在后端登记一行**，否则 `check-consistency` 报未登记 |
| `captures/`、`miniprogram/components/`、`miniprogram/templates/` | 按「不是页面」排除，报告里会打印排除的数目 |

`check-all.mjs --with-frontend` 仍有一项红（`check-ui-binding`）：小程序的 wxml 一个
`data-ui` 都没带，而它要求每个写入控件都带。CLAUDE.md 与后端 §2 让你跑的是**不带**
`--with-frontend` 的那条命令，补那一条等于给 55 页的写入控件逐个补标注。

### 7.4 范围判定不是 bug

服务端的范围 predicate 是真的。同一份数据，不同教师看到的笔数不同：别人的草稿看不见，
管理端未发布的党建内容看不见。**探针的断言要两头都钉**——写「看得见 N 条**且**这几个
id 不在里面」，只写「N 条」的话范围判定改坏了也可能照样是 N 条。

### 7.5 不可逆动作只测状态码等于没测

删除、状态迁移这类动作，**状态码对不算过**，还要回库里核对行数／状态没变。一个回
409 却真的删了行的实作，只看状态码是看不出来的。

### 7.6 断言形状 ≠ 断言值

`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$` 对 `12:00` 和 `20:00` 一样通过。

2026-09-01 撞过一次：服务端的 `fmtAt` 把裸值当本地时间转成 UTC 再缀上 `+08:00`，
**每个端点的每个 `*_at` 都早 8 小时**（库里 `2026-04-21 16:18:00`，线上
`2026-04-21T08:18:00+08:00`）。五支探针 212 项断言**一支都没抓到**，因为它们断言的
是格式。同一个根因还偏了游标的边界。

所以：**时间、计数、枚举这类有确定答案的值，断言要钉到库里的那一行**，
不是钉到回包的形状。`probe-parent-task.mjs` 的写法是拿
`to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00'` 与回包逐条比。

这与 §7.4「范围断言两头钉」、上一轮那条「回包不带某一列时，只看回包会把『没落库』
读成『没这个字段』」是同一条教训的三种形态。

---

## 8. 开工前必读

| 文件 | 为什么 |
|---|---|
| `decision.md` | **本仓库改动的第一顺位参考。** 第 19–26 条有 4 条反过来推翻了后端已定规则 |
| `docs/DO-NOT-BUILD.md` | 每张施工票据开工前逐条核对，核对结论写进票据。清单只增不删 |
| `docs/handoff/` 最新一份 | 上一轮做到哪、留了什么坑 |
| `hualong-backend/DECISIONS.md` | 权威顺序第一。多项决议已定但 DDL 未落地，只读 SQL 会做错 |
| `hualong-backend/db/01_schema.sql` | 唯一的字段级权威，每列带中文 COMMENT |
| `hualong-backend/db/GAPS.md` | 已登记的缺口。撞到对不上的地方先查这里 |

**权威顺序**：`DECISIONS.md` > `db/01_schema.sql` > `db/DATABASE_SPEC.md` >
`docs/backend spec files/` > 前端原型。

原型排最后。原型里看着像内容的东西，很多没有数据源——照片占位块、
「18 位家长已查看」、写死的文件名。**没有数据源就不要渲染它**，更不要编一个出来。

### 8.1 这几份文件各是什么，不要混

名字都长得像「一张表」，管的却是四件不同的事。混过一次：有人把 `screens.tsv`
读成了「数据库将来的 schema」，于是以为改登记表就能改主键。

| 文件 | 它是什么 | 谁维护 | 它**不是**什么 |
|---|---|---|---|
| `hualong-backend/db/spec/screens.tsv` | **屏幕登记表**。一个屏幕一行，84 行。列有：原型文件、小程序文件、模块、主要表、`writes`、`ugc`、`moderation_required` | 手写 | 不是 schema。里面没有列名、没有类型、没有主键、没有外键，将来也不会变成 |
| `hualong-backend/db/01_schema.sql` | **唯一的字段级权威**。62 张表 / 719 列，每列带中文 COMMENT，主键与外键都在这里 | 手写 | 不是登记表。它不知道哪一页长什么样 |
| `hualong-backend/db/spec/columns.tsv` 等六份 | **生成物**，由 `schema-to-tsv.mjs` 从 `01_schema.sql` 抽出来 | 机器生成 | 不要手工编辑。改了下次重跑就没了 |
| `hualong-backend/api/openapi.yaml` | **契约**。端点、请求体、响应体、状态码、角色 | 手写 | 不是 schema。字段名与库列名不保证同名 |

主键在 `01_schema.sql` 里。教师是 `db_teacher.teacher_id`，幼儿是 `db_child.child_id`，
两者都已经存在，不需要谁把它们「变出来」。

**L6 那一层报的到底是什么。** `npm run scan:wiring` 的第六层拿 `screens.tsv` 的
`writes` 列跟页面代码对照，报的是这一句：

> 登记表说这一页会写数据，但页面里找不到任何 POST／PUT／PATCH／DELETE。

也就是**写的那一半还没做**。它**不是**在说登记表填错了。真的填错时（`my-training`
就是一例：登记 `writes=yes`，页面与原型都没有任何写入控件），改的是登记表那一格，
但那是另一回事，要单独判断。

**L2 那一层报 0 条，不等于没有漏接的按钮。** 它靠词表判断「长得像能点」：
`buttonish()` 的三张表（`BUTTON_CLASS`／`CONTAINER_CLASS`／`BUTTONISH_TEXT`）
2026-09-09 按实测校准过 —— 244 个带 `bindtap` 的节点里认得出 202 个。
**剩下 42 个用的是页面本地一次性类名**（`image-box`、`rub-toggle`、`sheet-mask`、
`input__send` 之类），任何全局词表都覆盖不到。那不是词表没调好，是命名本身没有共性。

要闭合只有一条路：立「可点元素必须带 `hover-class`」的约定。`hover-class` 是本仓库
最干净的信号 —— 103 处，100% 落在已带 tap 的节点上。约定成立，L2 的召回就是 244/244。
代价是给 141 个已带 tap 却没 `hover-class` 的节点补属性，那是一次跨 55 页的改动。

`--selftest` 有 24 项断言，其中 14 项钉 L2（词表互斥、容器不算按钮、同一段文案在
`.btn` 上报、在 `.kicker` 上不报）。**改词表先跑它。**

**部署长什么样。** 文件放腾讯云 COS，`db_file` 只存元数据与对象键（`API-CONTRACT.md`
§8）；PostgreSQL 跑在云主机上（`hualong-backend/CONTEXT.md`）。库里从来不存图片本身，
也不存可直接访问的明文直链（`db/GAPS.md` G16）。

---

## 9. 两个不要清的题库

**两份是两套不同的量表，不是同一份抄了两遍**：

| 文件 | 内容 | 权威 |
|---|---|---|
| `miniprogram/pages/assessment-tool/assessment-data.js` | **办园质量评估** 120 题，评的是幼儿园／班级／教师 | 无外部权威，developer 维护的版本化代码资产（F17） |
| `miniprogram/pages/comprehensive-assessment-form/questions.js` | **《指南》教师评定量表** 124 题，评的是幼儿 | `data/guide-scale.json` |

两者曾共用一张表，那是个错误，见后端 `db/GAPS.md` 的 G5。

### 124 题那一份删不掉，所以给它装了闸门

`data/guide-scale.json` 是权威，但它**在 `miniprogram/` 之外** —— 小程序打不进包，
页面 `require` 不到。所以 `questions.js` 里那一份**删不掉**。

删不掉就让它漂开时当场失败：`npm test` 的第 7 段**逐题比对提问与三档锚点**，
不一致就红。这是 §7.3 那条的同一个应用 —— **一份复制品不是冗余，是一次静默过期；
要么只有一份，要么当场失败。**

闸门验过会红：改一个字，`npm test` 当场报 `H1-1-1 的提问与权威不同`。

**第三份在后端**（`db/rubric/guide-scale-v1.json`，灌数据集用），三份内容目前逐字相同。
后端那份没有进这个闸门 —— 跨仓库比对要先解决「两个仓库各在什么版本」，暂未做。

### 要真正只留一份，就得改成从接口取

数据集里 `db_scale_item` 正好 124 行，所以可行。**但那是一个要先问的决策**，
不要自己拍：它会牵出 G5（五维分数无处存）、G15（量表无模板表）、G27（身高体重题
无评分规则），还要定领域代码 `H/L/S/K/A` 与 `f1..f5` 哪一套是权威。
