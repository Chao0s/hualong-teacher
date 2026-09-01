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
cd /d/hualong-backend
node db/tools/check-all.mjs
```

**Swagger 站点不用手工改。** 它由 `npm run docs:api` 从 `api/openapi.yaml` 生成，
本仓库只读契约、从不复制一份（`tools/openapi-source.mjs` 的头注写明了理由：
一份复制品会悄悄过期，而过期的契约比没有契约更糟）。

### 顺序不能反

薄契约服务端的**路由表是从契约生成的**。所以顺序永远是：

1. 先改 `api/openapi.yaml`
2. 再改服务端实作
3. 最后改客户端

跳过第 1 步，服务端会回 `501`，而且「漏实作」与「不存在」在外面看起来一模一样。

---

## 3. 现状

`miniprogram/` 共 **55 页**，**18 页已接 API**，**37 页仍是写死的字面量**。

判断某一页属于哪一类：看 `index.js` 里有没有 `require('../../services/`。
在开发者工具里看 Network 面板有没有 `/api/v1/...` 请求，是同一件事的另一种查法。

| 已接 | 页 |
|---|---|
| 资源与案例库 | `resource-library`、`resource-detail`、`case-library`、`case-detail`、`upload-resource` |
| 党建 | `school-affairs`、`party-study-list/detail`、`party-activity-list/detail`、`party-brand-list/detail` |
| 在园时光 | `home-school-moments`、`home-school-moment-feed`、`home-school-moment-publish` |
| 亲子任务 | `parent-tasks`、`parent-task-detail`、`parent-task-publish` |

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
cd /d/hualong-backend/db/testdata
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
| 权限 | `node authz-tests/run.mjs --base http://localhost:3860/api/v1` | 七组越权探针 |
| **渲染** | **开发者工具里真点** | **上面全部查不出来** |

探针在 `tools/`：`probe-session`、`probe-library`、`probe-library-write`、`probe-party`、
`probe-moments`、`probe-parent-task`。它们桩掉 `wx.*` 之后**加载未经修改的发布代码**，所以路径写错、字段
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

后端在 `D:\hualong-backend`，与本仓库是兄弟目录。`tools/openapi-source.mjs` 与
`tools/lib/testdata-path.mjs` 都按 `../hualong-backend` 找它，**不复制一份**。

2026-09-01 撞过一次：当时有**两份**后端克隆，D 盘一份、Google Drive 一份，
候选表把 D 盘排在前面，而 D 盘那份落后两个提交。于是 `npm run spec:inventory`
报的是 v0.6 的 128/153，`npm run docs:api` 生成的是 v0.6 的 Swagger 站点，
**全程没有任何报错**。候选表里那条备用路径已经删掉：一份复制品不是冗余，
是一次静默过期。**要么只有一份，要么当场失败。**

判断读到的是哪一份：`node tools/spec-inventory.mjs` 第一行会打印契约文件的绝对路径，
计数应为 **125 paths / 150 operations / 135 schemas**。对不上就是读错了文件。

`node db/tools/check-all.mjs` 现在会重新生成 `db/spec/ui-binding.tsv` 且**行数正确**
（833 行，前后端在同一个盘上、生成器找得到前端了）。但它会刷新 70 行标签文案，
那是生成物的正常更新、不是你的改动，**跑完 `git checkout -- db/spec/`**。

`check-all.mjs` 现在 **8 项全过**。它的 `check-consistency` 一步曾经红过一阵：那一步扫
前端所有 `.html` 与 `.wxml`，问每个文件有没有 `screens.tsv` 的登记行，而登记表只认原型
文件名（`screens/home.html`），不认识 `miniprogram/pages/home/index.wxml`。
2026-09-01 已修：`screens.tsv` 加了 `mp_file` 列，一个屏幕一行、两个定位符。

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

---

## 9. 两个不要清的题库

`README.md` 明写「题库不得在页面里另抄一份」：

| 文件 | 内容 |
|---|---|
| `miniprogram/pages/assessment-tool/assessment-data.js` | 办园质量评估 120 题 |
| `miniprogram/pages/comprehensive-assessment-form/questions.js` | 《指南》教师评定量表 124 题 |

权威是 `data/guide-scale.json`。数据集里 `db_scale_item` 正好 124 行，所以「改成从接口
取」可行——**但那是一个要先问的决策**，不要自己拍。
