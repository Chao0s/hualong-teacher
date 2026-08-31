# 交接：小程序清假数据 + 接模拟后端数据库

日期：2026-08-31
仓库：`D:\hualong-teacher` · 分支 `master` · 已推到 `origin/master`（最新 `c20394f`）

---

## 1. 这一轮已经做完的（给路径，不重复内容）

| 事 | 去哪读 |
|---|---|
| 56 屏网页原型转小程序：转换手法、踩过的坑、工具清单 | `docs/handoff/2026-08-30-web-prototype-to-miniprogram.md` |
| 旧原生小程序 + 733 个测试归档：理由与捡回办法 | `Archive/20260831/README.md` |
| 目录改组的完整 diff | `git show c20394f` |
| 仓库总览、怎么打开、怎么自检 | `README.md` |

**一句话现状**：`miniprogram/` 是从网页原型转出来的**预览工程**，55 页、239 个文件、
静态自检六项全过（`npm test`）。**它一个接口都不调**，没有 service 层，
数据要么写死在代码里，要么存在 `wx.setStorageSync`。

---

## 2. 下一轮要做的

用户原话：「我会将一个模拟的 db 数据库接进来，我需要你先清除之前的虚假数据，
那些数据原先被写死在代码中，我需要你清理，并接入一个模拟的后端数据库」。

### 2.1 模拟数据库在哪

```
G:\My Drive\Personal Materials\App Dev\Hualong\hualong-backend\db\testdata
```

**这不是一堆数据文件，是一整套可跑的模拟后端。** 先读它自己的
`README.md`（10 KB）与 `STATS.md`，不要靠猜。

| 里面有什么 | 说明 |
|---|---|
| `testdata.sql` | 2.1 MB 灌库脚本，**62 张表 / 18134 行** |
| `dataset.json` | 46 KB 身份索引 |
| `server/` | **连 PostgreSQL 的薄契约服务端**，`node server/server.mjs`，默认端口 **3860** |
| `authz-tests/` | 越权测试跑测器与报告，`node authz-tests/run.mjs` |
| `generate.mjs` + `gen/` + `lib/` | 数据生成器，种子写死 `20260425`，同一份代码永远产出逐字节相同的 SQL |
| `pentest/` | 渗透测试 |
| `verify.sql` | 灌库后的校验 |

跑起来：

```bash
cd "G:/My Drive/Personal Materials/App Dev/Hualong/hualong-backend/db/testdata"
npm install                      # 只装一次，server/ 与 authz-tests/ 共用这一份
node server/server.mjs           # 默认 postgres://postgres:postgres@localhost:5432/hualong_test
```

端口与连接串可用 `--port` / `--db` 或 `PORT` / `DATABASE_URL` 覆盖。

**三条必须记住的**：

1. **数据集里的「今天」是 2026-04-25。** 真实日期已走完整个 2025-2026 学年，
   而要求的场景是「第二学期进行到一半」，两者无法同时成立。服务端的 `--today`
   参数就是这一天，当前学期按它派生。**读这份数据、测这套接口，都把这天当今天。**
2. **全部是假数据，仅供 demo/test。** 红线 5：生产环境所有业务表初始为空。
   这份数据不得以任何形式进入生产库。
3. **`testdata.sql` / `dataset.json` / `STATS.md` 是生成物，不要手工编辑。**
   改生成器再重跑。

规模抽样（完整表见 `STATS.md`）：`db_child` 60、`db_teacher` 13、`db_parent` 79、
`db_class` 6、`db_moment` 126、`db_growth_book` 120、`db_child_assessment_item` 10055、
`db_scale_item` 124、`db_notification` 1203。

### 2.2 仓库里还有一个 mock，别搞混

| | 端口 | 是什么 |
|---|---|---|
| `mock/server.mjs`（本仓库，5754 行） | **3820** | 早先写的契约 mock，`npm run mock`。另有 `mock:unbound`、`mock:no-term` 两个变体档 |
| `db/testdata/server/server.mjs`（上面那个） | **3860** | 连真 PostgreSQL 的薄契约服务端，数据来自 18134 行的数据集 |

**先问用户接哪个**（见 §2.5 第 2 条）。两者都实现同一份契约，但一个是内存造数、
一个是真库查询，行为不会完全一致。`.claude/skills/hualong-api-test/known-gaps.json`
登记了 15 条**故意的**契约偏离，每条在 `mock/server.mjs` 里有解释——排查不一致前先看它。

### 2.3 假数据住在哪（已清点）

| 位置 | 规模 | 性质 |
|---|---|---|
| `miniprogram/pages/*/index.js` 的 `data` | 22 个页面写了字面量数组，合计约 281 行字面量对象 | **要清** |
| `miniprogram/utils/growth-book.js` | `BOOK_CHILDREN`（12 名幼儿）、`BOOK_TASKS`（5 个亲子任务）、`OPENING_DAY_TEXTS`（10 段家长文字）、`defaultTaskSelections()` | **要清** |
| `miniprogram/pages/growth-book-time-manage/index.js` | `ACTIVITY_NAMES` 48 条 + `demoActivities()` 播种逻辑 | **要清** |
| `miniprogram/pages/coordination-file-list/index.js` | 最多的一页，约 35 行字面量 | **要清** |
| 本地存储 3 个键 | `hualong.growth-book.v1`、`hualong.comp-assessment.v1`、`hualong_assessment_v1` | 见 §2.5 第 1 条，**先问清楚再动** |

写字面量最多的前几页（行数粗估）：`coordination-file-list` 35、`teacher-task-detail` 18、
`teacher-profile` 18、`upload-resource` 16、`teacher-message` 13、`school-affairs` 12、
`resource-library` 12、`teacher-evaluation` 10、`party-study-detail` 10、
`home-school-moment-publish` 10、`home-school` 10、`home` 10。

用 `StorageSync` 的只有 6 个文件：`pages/assessment-tool/index.js`、
`pages/community-coeducation/index.js`、`pages/home/index.js`、
`pages/home-school-moment-feed/index.js`、`utils/assessment-store.js`、`utils/growth-book.js`。

### 2.4 两块**不是假数据、不要清**的

`README.md` 明写「题库不得在页面里另抄一份」：

| 文件 | 大小 | 权威 |
|---|---|---|
| `miniprogram/pages/assessment-tool/assessment-data.js` | 81 KB / 120 题 | 办园质量评估，固定版本，developer 维护，admin 不可编辑 |
| `miniprogram/pages/comprehensive-assessment-form/questions.js` | 51 KB / 124 题 | 《指南》教师评定量表 v1.0，权威在 `data/guide-scale.json` |

**它们确实是「抄了一份」**（从 `screens/` 机械转换来的），既不是假数据、
也不该长期留在页面里。数据集里有 `db_scale_item` 124 行——**正好对得上 124 题**，
所以「改成从接口取」是可行的。**这是要问用户的决策**，见 §2.5 第 3 条。

### 2.5 四个必须先确认再动手的点

1. **本地存储怎么办。** 成长册整条线（编册、四个管理页、三个预览页、版面编辑器）
   把配置写进 `wx.setStorageSync('hualong.growth-book.v1')`。接 DB 后它是
   **变成缓存**、**整个去掉**、还是**先留着当离线兜底**？这决定改动量差一个量级。
2. **接哪个 mock**：`db/testdata` 的 3860（真库），还是仓库里 `mock/` 的 3820（内存）。
   前者要本机有 PostgreSQL 并灌好 `testdata.sql`。
3. **两个题库怎么处理**：留在页面里、挪到 `data/` 下由构建期注入、还是改成从
   `db_scale_item` 取。三种都说得通，代价不同。
4. **改哪些页**：55 页全接，还是先接一条线跑通再照抄。**建议先接成长册**——
   它最完整也最复杂，数据集里对应的表最全（`db_growth_book` 120、
   `db_growth_material` 138、`db_book_widget` 48、`db_book_material_submission` 157）。

---

## 3. 建议的做法

1. **先问清 §2.5 四个问题**，再动代码。用 `AskUserQuestion`，别在正文里问。
2. **先建 service 层再删假数据**，顺序反了会有一段时间页面全白。
   照 `Archive/20260831/miniprogram/services/`（16 个文件）的写法：一个模块一个文件，
   页面 `require` service，**不在页面里拼 URL**。那是现成范式，不要另发明。
3. **要有 `config.js`**（旧工程有，已归档）：`baseUrl` 分环境，生产必须 https。
   开发者工具调 `http://localhost:3860` 需要「不校验合法域名」——根目录
   `project.config.json` 里 `urlCheck: false` 已经是关的，不用再改。
4. **接口路径必须对得上契约。** 命名权威是 `docs/backend spec files/` 里的
   `ui=` 标注（共 424 处），控件上的 `data-ui` 必须对得上某一条。
   客户端调一条契约没声明的路径，线上 404、页面空白、**没有任何测试会红**。
5. **一页一页改，每页改完跑 `npm test`。** 它查不出接口对不对，但能拦住
   四件套缺文件、类名落空、`wx:for`+`wx:else` 这类结构错。

---

## 4. 别踩的坑

- **`decision.md`（647 行）是本仓库改动的第一顺位参考**，改任何页面前先读。
  第 19–26 条有 4 条反过来推翻了后端已定规则。
- **`docs/DO-NOT-BUILD.md`（32 行）每张施工票据开工前逐条核对**，清单只增不删。
- **`.claude/skills/hualong-api-test/layers/contract.mjs`** 里 teacher 客户端指向
  `miniprogram/services`，那个目录现在不存在，skill 会「跳过并说明理由」。
  **建好 service 层后它会自动重新生效**，不用改它。
- **`package.json` 有两个死依赖**（`miniprogram-ci`、`miniprogram-automator`），
  只有归档掉的 `verify-build.mjs` 在用。要删得连 `package-lock.json` 一起重生成，
  否则 CI 的 `npm ci` 会失败。
- **`npm test` 现在不是单元测试**，是 `node tools/verify-miniprogram.js` 静态自检。
  **`Archive/20260831/tests/` 有 733 个现成的、归档当天全绿的测试**，测的正是
  service 层与契约的接缝。捡回办法在 `Archive/20260831/README.md`。
  **这大概是接完 DB 之后最该做的一件事。**
- **上游后端仓库**是 `hualong-backend`，`db/testdata` 就在它里面。
  `DECISIONS.md`、`db/GAPS.md`、`db/01_schema.sql` 是字段级权威。
  本仓库 `docs/backend spec files/00 Demo DB Structure.txt` 只有 74 行，是**早期结构草稿**，
  与 62 张表的实际 schema 不是一回事，**以 `db/01_schema.sql` 为准**。

---

## 5. 怎么验证做完了

| 检查 | 命令 / 做法 |
|---|---|
| 结构没坏 | `npm test` 六项全过 |
| 没有残留假数据 | 全仓 grep `BOOK_CHILDREN`、`ACTIVITY_NAMES`、`OPENING_DAY_TEXTS`；页面 `data` 里不该再有成排字面量 |
| 接口真的通 | 起 3860 服务端，开发者工具逐页点，看 Network 面板 |
| 路径对得上契约 | 跑 `hualong-api-test` skill 的 contract 层 |
| 权限没漏 | 跑数据集自带的 `node authz-tests/run.mjs` |
| 渲染没坏 | **静态自检查不了渲染**：`<editor>`、`canvas`、拖曳、翻页动画必须在开发者工具里真点一遍 |

**报告时给数字**，别说「测试通过」——这是这个仓库一直在用的口径。

---

## 6. 建议调用的 skill

| skill | 什么时候用 |
|---|---|
| `hualong-api-test` | **接完 service 层就跑。** 专查客户端调的路径与契约、DB、COS、VM 对不对得上，已经真抓到过 5 次 bug |
| `context7-mcp` | 查小程序 API（`wx.request`、`<editor>`、`canvas`）与任何库的用法。**别凭记忆答** |
| `mattpocock-skills:tdd` | 决定把 `Archive/20260831/tests/` 那 733 个测试捡回来时，用它带着 red-green-refactor 走 |
| `mattpocock-skills:diagnosing-bugs` | 接口通了但页面不对时用，别瞎猜 |
| `caveman-commit` | 写提交信息 |

**不建议**用 `huashu-design`——这是接数据，不是做新设计。

---

## 7. 环境与敏感信息

- 仓库 `https://github.com/Chao0s/hualong-teacher`，分支 `master`，最新提交 `c20394f`。
- AppID 在根目录 `project.config.json`（公开的小程序 AppID，非密钥）。
- 模拟库默认连接串 `postgres://postgres:postgres@localhost:5432/hualong_test`
  是**本机 demo 的默认值**，不是生产凭证。
- **本文档不含任何密钥。** 仓库里两处涉密，都不在版本库中，也不要写进任何文档：
  - `MP_PRIVATE_KEY`（miniprogram-ci 上传私钥，`.gitignore` 里 `*.key`）
  - `BACKEND_TOKEN`（GitHub Actions secret，读私有的 hualong-backend 仓库）
