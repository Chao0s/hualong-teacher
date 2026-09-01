# 交接：党建 7 页 + 在园时光 3 页，契约改到 v0.7

日期：2026-09-01
前端 `D:\hualong-teacher` 分支 `master` → `f190aea`，已推
后端 `hualong-backend` 分支 `main` → `b7373a7`，已推

> 接在 `2026-08-31-api-integration.md` 之后。那一份的 §4 与 §7（会咬人的地方）
> 仍然有效，本文不重复。**新增的坑在本文 §5。**

---

## 1. 现状

`miniprogram/` 共 **55 页**，**15 页调 API**，**40 页仍是写死的字面量**。

| 已接 | 页 | service |
|---|---|---|
| 资源与案例库 | `resource-library`、`resource-detail`、`case-library`、`case-detail`、`upload-resource` | `services/library.js` |
| 党建 | `school-affairs`、`party-study-list/detail`、`party-activity-list/detail`、`party-brand-list/detail` | `services/party.js` |
| 在园时光 | `home-school-moments`、`home-school-moment-feed`、`home-school-moment-publish` | `services/co-education.js` |

验证口径（都是实跑的数字）：

| 检查 | 命令 | 结果 |
|---|---|---|
| 结构自检 | `npm test` | 6 项全过 |
| 孤儿样式 | `node tools/scan-orphans.mjs` | 无新增 |
| 接口探针 | `node tools/probe-{session,library,library-write,party,moments}.mjs` | **212 项断言，0 失败** |
| 后端 harness | `node db/tools/check-all.mjs` | 8 项全过 |
| 越权测试 | `node authz-tests/run.mjs --base http://localhost:3860/api/v1` | 879 次探针，七组全过 |
| 数据库 | 探针自己对账 | 逐表与 `STATS.md` 一致 |

---

## 2. 这一轮做了什么

### 2.1 党建 7 页（只读）

7 条端点全部只读。这一族**没有写入函数，也不该有**——党建内容由管理员在 PC 后台
发布，DO-NOT-BUILD 2 规定教师端不通往后台。

### 2.2 在园时光 3 页（读＋写＋删）

补上了前两条线没测到的**状态机**与**物理删除**。

### 2.3 契约改到 v0.7 —— 这是本轮最大的一件事

园方拍板改了在园时光的两处设计。**契约、登记表、服务端、客户端四处同一轮改完。**

| | v0.6 | v0.7 |
|---|---|---|
| 建立 | `POST /moments` 建 `s1` 草稿 → `PATCH` 自动保存 → `POST …/publication` 发布 | `POST /moments` **一次提交即 `s3`** |
| 纠错 | `POST …/withdrawal`（s3→s5）+ `restoration`（s5→s3） | `DELETE /moments/{id}` **物理删除** |
| 客户端 | 自动保存 | **发布前 `wx.showModal` 确认一次** |

退役 4 个操作、新增 1 个。计数：**128 → 125 paths / 153 → 150 operations /
127 → 123 动作 / 缺口 67 → 69**。

删除在同一交易内解除 `db_moment_upload`、`db_file_ref`、`db_growth_material`
入册通道。**入册通道即便编册已锁定（`e2`）也照解**——沿用
`05 home-school-spec.md`「来源撤回／下架／依法删除仍只解除该来源通道与引用」。

两条前置沿用旧决议，没有新发明：只有原发布教师可删且学期须在进行中（Q59-n6）；
**管理员已下架的不可删**（回 409 `admin_action_exists`，与 Q59-m1a「教师不得推翻
管理员撤回」同一条理由）。

理由全文在 `hualong-backend/docs/API-CONTRACT.md` §15 的 v0.7。

### 2.4 修好薄服务端五处与契约不符的地方（契约未改）

这五处都是**实作没照契约做**，不是契约的问题。全部用原始 curl 绕开客户端复现过。

| # | 症状 | 后果 |
|---|---|---|
| 1 | `GET /moments/weekly-coverage` 的 `WHERE` 里一句把 `LEFT JOIN` 变回 `INNER JOIN` | 在别的周有上传、本周没有的幼儿**整行消失**，不是显示 0 次。全班无记录的那一周回空集合 |
| 2 | `POST /moments` 收下 `child_id` 却建 0 行 `db_moment_upload` | 教师勾的名单存不住，周覆盖永远不变——模块核心空转 |
| 3 | `GET /moments` 不回 `file_id` | feed 上只有文字没有图 |
| 4 | `moment_date` 不验学期与「不晚于园所今天」 | 跨学期日期照收 |
| 5 | 详情的附件键名是 `file_ids`，契约写 `file_id` | 客户端得两个都读 |

另加 `/_placeholder/{file_id}.png`：服务端不接对象存储，取图原本回
`example-cos.invalid`，形状对但渲染不出来。改为图片指向本机现生成的纯色 PNG，
**文档类仍回假地址**——给一份 PDF 配一张纯色 PNG 只会让人以为取档成功了。

### 2.5 新增两条缺口

- **G68** 在园时光入册通道有表、有 138 行数据、**零 API 面**。
  `home-school-moment-feed` 的「加入成长册」与 `growth-book-time-manage` 要的是
  **同一族端点**，应一次设计，不为其中一页先补一次。
- **G69** `db_moment.publish_status` 的 `s1` 已被拍板宣告永久空置，CHECK 取值域未清。
  照 G45→G46 的先例，退役编码要走 schema 改动流程。

---

## 3. 下一条线建议：亲子任务

`/home-school/parent-tasks` **7 条端点全部已实作**，页面 3 张
（`parent-tasks`、`parent-task-detail`、`parent-task-publish`），
`services/co-education.js` 已经建好、直接往下写。

它多出来的是**计划时间**：`start_at` / `due_at` 是 §1.2 白名单里的列，必须带
`+08:00` 字面量提交，`utils/time.js` 的 `toWireTimestamp` / `fromPickerParts`
已经备好。

### 其余模块的端点现状（teacher 可达 / 已实作）

| 模块 | 端点 | 页 | 备注 |
|---|---|---|---|
| 亲子任务 | 7 / 7 | 3 | **建议下一条** |
| 家园其他（社区、评价、月评） | 6 / 6 | 4 | 接完亲子任务顺水推舟 |
| 成长册 | 18 / 18 | 9 | 版式包 0/12 已发布，`manifest` 回 409；且要先定本地存储去留 |
| 评价与评估 | 9 / 9 | 10 | 要先定两个题库怎么处理 |
| 教研培训 | 7 / 7 | 6 | 报名与取消报名是幂等写 |
| 教师档案 | 3 / 3 | 2 | 资料更正走申请制（G45） |
| 待办任务 | 3 / 3 | 2 | 数据只有 6 条 |
| 综合协调 | 2 / 2 | 2 | 纯只读，与党建同形 |

**`teacher-message` / `teacher-message-detail` 两页接不了**：契约里根本没有
`/notifications` 端点（150 条路由里搜不到任何 notification 路径），而
`db_notification` 有 1203 行数据。上游 README 已把它登记为契约缺口。

**`home` 留到最后**：没有 `/home` 聚合端点，它要的数据分散在各模块。

---

## 4. 做法（三条线都这么走的）

1. **先写 service，再写探针，最后改页面。** 前三条线都靠这个顺序在改页之前就抓到
   真问题：`resource_access` 是必填、`resource_ids` 不落库、`child_id` 收下即丢。
   页面改完再测，问题会混在渲染问题里。
2. **枚举表只写一份，写在 service 里。** 权威是 `db/01_schema.sql` 的列注释。
3. **必填字段以 DDL 的 `NOT NULL` 为准。** 不要照契约的 `required`（好几个写入
   schema 没写），更不要照表单长什么样——原型的上传表单漏了一个 `NOT NULL` 列，
   那张表单在原型里根本提交不成功。
4. **会改库的探针必须自己收拾**，跑完核对逐表行数回到 `STATS.md`。
5. **改了前后端之间的关系，同一轮更新契约**。规则写在 `CLAUDE.md` §2。

---

## 5. 本轮新踩的坑

### 5.1 `check-all.mjs` 会静默损坏一个生成物

在这台机器上跑 `node db/tools/check-all.mjs` 之后，`db/spec/ui-binding.tsv`
**从 833 行掉到 334 行**——丢的全是来自前端 `docs/backend spec files/` 的 teacher 行。
生成器按兄弟目录找 `../hualong-teacher`，而它在 D 盘，找不到就产出一份残缺的。

**八项检查全绿。** 与仓库自己记过的那次「套件因为根本没跑而报绿」（commit `f5a31c6`）
同一类问题。

> **跑完 harness 记得 `git checkout -- db/spec/`。**
> 未做：给生成器加一道断言，找不到前端仓库就报错而不是产出残缺文件。

### 5.2 后端仓库不要用 `git pull --rebase`

`db/testdata/pentest/` 不可读（`Permission denied`，Google Drive 产物且未被 git
跟踪）。git 扫描未跟踪文件时被打断，rebase 会停在半路：**工作树回到旧内容、
`git log` 里你的提交消失**。

本轮撞上过一次。恢复办法：`git rebase --abort` 回到提交，改用 `git merge`。
提交对象不会丢（在 reflog 与对象库里）。

### 5.3 `db/spec/*.tsv` 与 `api/*.tsv` 有 CRLF 幻影

它们显示 modified 但 `git diff` 无内容差异。`946b466` 只给 `db/testdata/` 加了
`.gitattributes`，这两处是既有范围，没动。**不要提交这类零差异改动。**

### 5.4 探针的断言别写松

本轮写过一条 `check('child_id 生效', len === 2 || len === 0)`——那个 `||` 把真失败
放过去了。改成直接查库计数才抓到「服务端收下即丢」。

**回包不带某一列时，只看回包会把「没落库」读成「没这个字段」。**

---

## 6. 环境

```bash
# PostgreSQL 本地 5432
cd "G:/My Drive/Personal Materials/App Dev/Hualong/hualong-backend/db/testdata"
node server/server.mjs          # → http://localhost:3860/api/v1
```

换用户：改 `miniprogram/config.js` 的 `devSubjectId`，重新编译。名册在那个文件的
注释里。1–12 在职，**13 已离职，登录会失败**（数据集刻意造的反例）。

`urlCheck` 两个配置文件里都是 `false`，开发者工具可直接打 `http://127.0.0.1`。

---

## 7. 没做的

- **渲染一次都没在开发者工具里验过。** 探针桩掉了全部 UI 调用，`<image>`、
  垃圾桶图标的位置与大小、确认弹窗的文案换行，全部测不到。
- **G68 的入册端点**没补。feed 页的「加入成长册」仍写 `wx.setStorageSync`。
- **撤回/恢复没有 UI 归属**：规格的 `ui=` 命名空间里有 `moment_detail.*`，
  而原型 55 页里没有「时光详情」页。v0.7 之后这一条变成「删除按钮放哪」，
  已放在 feed 卡片的时间戳旁。
- **`data/guide-scale.json` 与两个页面内题库**仍是三份。改成从 `db_scale_item`
  取是可行的（正好 124 行），**但那是一个要先问的决策**。
