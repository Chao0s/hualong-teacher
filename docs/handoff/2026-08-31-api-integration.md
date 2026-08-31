# 交接：12 页已接契约 API，43 页还写死

日期：2026-08-31（当天第二份，接在 `2026-08-31-miniprogram-mock-db.md` 之后）
仓库：`D:\hualong-teacher` · 分支 `master` · 已推到 `origin/master`

> 上一份交接（`2026-08-31-miniprogram-mock-db.md`）问的四个问题已经答完、做完两条线。
> **它的 §2「下一轮要做的」已过期**，但 §2.1（模拟库在哪）、§2.4（两个题库不要清）、
> §4（别踩的坑）仍然有效，不重复。

---

## 1. 一句话现状

`miniprogram/` 55 页里，**12 页真的调 HTTP 取数**，43 页仍是写死在页面里的字面量。
判断任意一页属于哪一类，看 `require('../../services/` 在不在它的 `index.js` 里；
在开发者工具里看 Network 面板有没有 `/api/v1/...` 请求，是同一件事的另一种查法。

| | 页数 | 页 |
|---|---:|---|
| 已接 | 12 | `school-affairs`、`party-study-list/detail`、`party-activity-list/detail`、`party-brand-list/detail`、`resource-library`、`resource-detail`、`case-library`、`case-detail`、`upload-resource` |
| 未接 | 43 | 见 §5 |

---

## 2. 建了什么

### 2.1 service 层（`miniprogram/`）

```
config.js              环境与 devSubjectId
utils/request.js       唯一的 HTTP 出口。契约 §1–§5 只在这里实现一次
utils/errors.js        §2.4 错误码登记表，ApiError
utils/derived.js       §7.3 derived 键，发出前剥离
utils/session.js       §6.3 会话状态
utils/time.js          §1.2 时间戳，偏移量是字面量不是换算
utils/auth.js          登录（改过，见下）
utils/guard.js         §7.2 角色闸门（改过，见下）
services/library.js    /library/* 14 条端点
services/party.js      /party/*  7 条端点
```

前六个是从 `Archive/20260831/miniprogram/` **逐字节原样移植**的，不要重写。
`auth.js` 与 `guard.js` 改过，两处改动都是承重的：

| 文件 | 改了什么 | 不改会怎样 |
|---|---|---|
| `auth.js` | 走 `POST /dev/session` | `POST /auth/session` 在测试服务端是 `blocked`（它不调微信），走不通 |
| `guard.js` | 删掉 `TAB_PAGES`／`wx.switchTab`；`endSessionOnAuthFailure` 恒返回 `false` | 这套原型工程 `app.json` 里**没有 tabBar**（底栏是 `hl-tabbar` 组件走 `reLaunch`），`wx.switchTab` 打非 tab 页**静默失败**，5 个入口会变成死的；`return true` 会让页面在 401 时白屏 |

### 2.2 探针（`tools/`）

四个，跑的都是**未经修改的发布代码**，只桩掉 `wx.*` 平台 API。桩与计分板在
`tools/lib/wx-stub.mjs`，四个共用一份。

| 命令 | 断言数 | 测什么 |
|---|---:|---|
| `node tools/probe-library.mjs` | 47 | 资源与案例库只读路径 |
| `node tools/probe-library-write.mjs` | 20 | 写入路径。**会建行，跑完自己删干净并核对行数回基线** |
| `node tools/probe-party.mjs` | 64 | 党建 7 条端点 |
| `node tools/probe-session.mjs` | 8 | 会话恢复与凭证撤销，**带 15 秒超时**（死锁会红，不会挂住） |

`npm test` 是 6 项静态自检，查不出接口对错，但拦得住四件套缺文件、类名落空、
`wx:for`+`wx:else` 同节点这类结构错。

**2026-08-31 最后一次全绿记录**：139 项断言 + 6 项静态自检。之后 G 盘卸载
（见 §4.1），接口探针无法复跑；`npm test` 仍全过。

---

## 3. 三条服务端与契约的偏离（客户端做对了，对面还没接住）

**逐条都用原始 curl 绕开本客户端复现过**，所以缺口在服务端不在这里。
探针把它们记成「已知缺口」而不是失败 —— 每次跑都红一条，红久了就没人看了。

| # | 偏离 | 客户端怎么处理 |
|---|---|---|
| 1 | `GET /party/home` 不合 `PartyHome`：契约要 `carousel`／`latest_studies`／`latest_activities`／`latest_brands`，实际回 `studies`／`activities`／`brands`，且行内缺 `study_type`、`excerpt`、`activity_content`、`activity_status` | `services/party.home()` 改用三条**合契约**的列表端点并发拼。服务端补齐后换成一次 `api.get('/party/home')` 即可，**页面一行不用改** |
| 2 | `POST /library/cases` 收下 `resource_ids`、回 201、**存成 NULL** | 照契约发，不落库就是不落库；案例详情的关联资源因此为空，不编一条出来 |
| 3 | 附件键名是 `files`，契约写的是 `file_refs` | 两个都读，契约的优先（`services/party.js` 的 `fileRefs()`） |

---

## 4. 五个会咬人的地方

### 4.1 后端在 Google Drive 虚拟盘上，会卸载

`db/testdata` 在 `G:\My Drive\...`，是按需同步的虚拟盘。**它会在无预警的情况下
卸载**：2026-08-31 就发生过一次，`testdata.sql`、`dataset.json`、`STATS.md`、
`authz-tests/`、`server/server.mjs` 同时从目录里消失，**3860 服务端进程随之死掉**。

关键是别误判：

- **PostgreSQL 不在 G 盘**，数据一行没少（当时实测 62 张表、`db_child` 60 行、
  `db_teacher` 13 行，全部对得上）；
- **本仓库在 D 盘**，不受影响；
- 文件应该还在云端，等 Drive 重新同步即可。**不要重灌库**，那会把库里的东西覆盖掉。

### 4.2 会话在服务端进程内存里，客户端 token 在 Storage 里

`server/lib/auth.mjs`：`const SESSIONS = new Map()`，TTL 12 小时，注释写明
「重启即失效」。而客户端 token 存在 `wx.setStorageSync`，**跨重启存活**。
于是服务端每重启一次，模拟器里那张票就成了死票。

`utils/request.js` 已经处理：401 且 `devSession` 时清票、重签、重放一次。
**这一段有两个坑，改它之前先读那段注释**：

1. 登录过程内部那次 `GET /auth/session` 必须带 `skipAuthRetry` —— 否则它的 401
   会去 `await ensureSession()`，而那正是当前这次登录，**它在等自己**，页面永远
   停在加载中，不报错也不超时；
2. 登录失败必须清票（`auth.adoptSession` 的 catch）—— 否则 `isLoggedIn()` 从此
   说谎：本地有 token，`ensureSession()` 直接短路，而每一发业务请求还是 401。

`probe-session.mjs` 就是这两条的回归测试。

### 4.3 必填字段以 DDL 的 NOT NULL 为准，不要照着表单眼估

原型的上传表单**没有活动类型控件**，而 `db_case.case_area` 是 `TEXT[] NOT NULL` ——
那张表单在原型里根本提交不成功。同样地 `resource_access`／`resource_trans` 也是
NOT NULL，原型的校验只查了名称和解读。

**权威是 `hualong-backend/db/01_schema.sql`**，不是契约的 `required`（`ResourceWrite`
与 `CaseWrite` 都没写 `required`），也不是表单长什么样。

### 4.4 `npm test` 的孤儿样式检查有盲点

`tools/verify-miniprogram.js` 第 118–121 行：WXML 里只要出现一处
`class="a {{cond ? 'x' : ''}}"`，**整个文件跳过孤儿规则检查**。所以它报
「未被引用的规则 0 条」不代表真的没有。本轮手工清掉两批：`case-detail` 的 126 行
Word 详案样式、`resource-library` 的 7 个再也走不到的图标。改页面删内容后，
自己再扫一遍。

### 4.5 教师只看得见该看的，别把范围判定误读成 bug

服务端的范围 predicate 是真的。同一份数据，不同教师看到的笔数不同：

| 表 | 库里 | 教师 1 看得见 | 差在哪 |
|---|---:|---:|---|
| `db_resource` | 12 | 11 | `resource_id=5` 是教师 5 的草稿 |
| `db_case` | 10 | 9 | `case_id=6` 是教师 4 的草稿 |
| `db_party_study` | 5 | 3 | 一条 `s1` 草稿、一条 `s5` 已下架 |
| `db_party_activity` | 4 | 3 | 一条 `s2` 待审核 |

**探针的断言写成「看得见 N 条**且**这几个 id 不在里面」**，两头都钉住 —— 只写
「N 条」的话，范围判定改坏了也可能照样是 N 条。

---

## 5. 还没接的 43 页

按模块分，右列是契约里对应的端点族。**接之前先查 `coverage.tsv` 那一族实作了没有**，
契约里有而服务端回 501 的，接了也是白接。

| 模块 | 页 | 端点族 |
|---|---|---|
| 家园社共育 | `home-school`、`home-school-moments`、`home-school-moment-feed`、`home-school-moment-publish`、`parent-tasks`、`parent-task-detail`、`parent-task-publish`、`parent-evaluation-publish`、`parent-evaluation-detail`、`community-coeducation` | `/moments`、`/home-school/*` |
| 成长册 | `growth-book`、`growth-book-edit`、`growth-book-view`、`growth-book-sample`、`growth-book-section-edit`、`growth-book-section-materials`、`growth-book-task-manage`、`growth-book-time-manage`、`growth-record` | `/teacher/growth-book/*`、`/growth-book/books/*` |
| 评价与评估 | `teacher-evaluation`、`teacher-monthly-evaluation`、`teacher-monthly-form`、`teacher-term-evaluation`、`teacher-term-form`、`growth-comprehensive-assessment`、`comprehensive-assessment-form`、`comprehensive-assessment-report`、`comprehensive-assessment-class-report`、`assessment-tool` | `/home-school/month-evals`、`/term-evaluations`、`/children/*` |
| 教研培训 | `training-center`、`training-list`、`training-detail`、`my-training`、`course-building`、`resource-center` | `/trainings`、`/training-participations` |
| 待办与消息 | `teacher-tasks`、`teacher-task-detail`、`teacher-message`、`teacher-message-detail` | `/tasks/*`、`/notifications` |
| 综合协调 | `comprehensive-coordination`、`coordination-file-list` | `/coordination/documents` |
| 其他 | `home`、`teacher-profile` | 聚合页 / `/teacher-profile` |

**两个题库不要清**（沿用上一份交接 §2.4）：`assessment-tool/assessment-data.js`
（81 KB／120 题）与 `comprehensive-assessment-form/questions.js`（51 KB／124 题）。
数据集里 `db_scale_item` 正好 124 行，改成从接口取是可行的，但**那是一个要先问的决策**。

### 建议的下一条线

**家园社共育**。它有读、有写、有状态机（`s1` 草稿 → `s3` 已发布 → `s5` 已撤回，
且 `s5` 可恢复），端点齐，能把这套手法的最后一块（状态迁移）也跑通。
`home` 是聚合页，它要的数据分散在好几个模块，**留到最后接**。

---

## 6. 怎么跑起来

```bash
# 1. PostgreSQL（本地，5432）
# 2. 契约服务端
cd "G:/My Drive/Personal Materials/App Dev/Hualong/hualong-backend/db/testdata"
node server/server.mjs          # → http://localhost:3860/api/v1
```

`project.config.json` 与 `project.private.config.json` 里 `urlCheck` 都已是 `false`，
开发者工具能直接打 `http://127.0.0.1`，不用再改设置。

**换用户看不同的人看到什么**：改 `miniprogram/config.js` 的 `devSubjectId`，重新编译。
名册写在那个文件的注释里（1–12 在职，**13 罗慧兰已离职，登录会失败**——那是数据集
刻意造的反例，用来验证凭证撤销，不是坏数据）。

---

## 7. 怎么验证做完了

| 检查 | 命令 | 口径 |
|---|---|---|
| 结构没坏 | `npm test` | 6 项全过 |
| 接口真的通 | 四个 `node tools/probe-*.mjs` | **报数字**，不说「通过了」 |
| 没留假数据 | 页面 `index.js` 里不该再有成排字面量对象 | `grep -cE "^const [A-Z_]+ = [\[{]"` |
| 库没被弄脏 | 写探针跑完自己核对行数回基线 | 与 `STATS.md` 逐表对账 |
| 权限没漏 | `node authz-tests/run.mjs --base http://localhost:3860/api/v1` | 897 次探针，七组 |
| **渲染没坏** | **只能在开发者工具里真点** | 探针一概测不到 |

最后一行是硬约束：`tools/lib/wx-stub.mjs` 把所有 UI 调用桩成了空函数，
**渲染、swiper、翻页、`<editor>`、canvas、拖曳全都测不到**。探针全绿 ≠ 页面能看。

---

## 8. 目录里另外两样

- `captures/` 57 个 `.txt`：56 张原型页的源料 + `_index.txt` 清单（`web-capture` 抓的，
  `capturedBy: http-fetch`，存的是**服务器返回的原始 HTML**）。
  第 58 个 `home-rendered-dom.txt` 是浏览器扩展导出的 **JS 执行后的 DOM**，
  与 `home.txt` 是同一页的两种抓法（原始 HTML vs 渲染后 DOM），互补不重复；
  它不是 `web-capture` 产出的，所以不在 `_index.txt` 的清单里。
- `tools/web-capture/` 是抓取工具本身（`SKILL.md` + `scripts/capture.js`）。
  原型改版后要重抓时用它，不要手工存网页。
