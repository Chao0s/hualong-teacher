# 交接：按屏幕看 API —— 原型对账、G109–G112、地图 #76

交接日期：2026-09-12（Asia/Shanghai）。
**本轮由 herman925 完成。** 另一条开发线是 **linem7（朝湃）**，与本轮无交集。

本文件按用户指定保存在教师仓库 `docs/handoff/`，覆盖 handoff 技能默认写入系统临时目录的要求。

---

## 一、这一轮做完的四件事

| # | 做了什么 | 落在哪 |
|---|---|---|
| 1 | 原型↔逐页 API 映射表对账，**读 57 页**，报 15 missing / 9 invented / 18 unsure | `docs/audit/proto-vs-table-2026-09-12.md` |
| 2 | 用户裁为真缺口的四条登记进缺口册 | `hualong-backend/db/GAPS.md` **G109–G112**（后端提交 `30adf36`） |
| 3 | 开一张新地图 + 6 张子票 | 地图 **#76**，子票 **#77–#82** |
| 4 | 登录页接进应用（启动页 + 会话失效跳转） | 教师仓提交 `30951df`、`3260eac` |

**GAPS 计数实测**：缺口合计 由 104 条增为 **108** 条；GAP 级 由 56 条增为 **60**；BLOCKER 仍 **8**。`node db/tools/check-all.mjs` **10 项全过，exit 0**。

---

## 二、四条新登记缺口（G109–G112）

每条都**对着当前的 `openapi.yaml` 复核过**，判据写在 GAPS.md 的正文里，不是照抄子代理的措辞。

| 编号 | 一句话 | 屏（屏幕上叫） |
|---|---|---|
| G109 | 资源详情装不下「这个资源被哪些案例用了」 | `resource-detail`（资源详情） |
| G110 | `listResources`／`listCases` 都没有关键词参数 | `resource-center`（课程资源） |
| G111 | 教研培训部的首页聚合没有端点 | `training-center`（教研培训部） |
| G112 | 教师端读不到家长交上来的栏目素材 | `growth-book-section-materials`（栏目投稿） |

**同批报出但不登记的四类**，理由也写进了修订记录：三条是**客户端**该调契约已有的端点；一条是**原型过期**（`home-school` 总览五列 vs 契约三列）；四条**早已在案**（G89、G36 两处、G108），不重复登记。

**「我们自己发明的」9 条 —— 一条都不是凭空发明。** 每条都追到一份决议或规范节号（F5／F11／F16／F17／F27／Q59-*／G45／§4／§8／§10）。**要动的是原型，它落后于决议。**

---

## 三、地图 #76 与它的 6 张子票

地图目的地：**`db/spec/screen-operations.tsv` 里每一屏要用的操作，在契约里都有落点。**

| 票 | 类型 | 问的什么 |
|---|---|---|
| #77 | `wayfinder:grilling` | G109 补读端点，还是从原型摘掉 |
| #78 | `wayfinder:grilling` | G110 加 `keyword` 参数，还是本地过滤够用 |
| #79 | `wayfinder:grilling` | G111 补聚合端点，还是客户端多打几次 |
| #80 | `wayfinder:grilling` | G112 补读端点（先定范围规则），还是「查看」不做 |
| #81 | `wayfinder:task` | 让 56 屏能真渲染（装开发者工具 + 已装的 automator） |
| #82 | `wayfinder:task` | 三页该调契约已有的端点（档案回显／取档／照片来源） |

**四张决策票都在等人拍板。** 四条的正文里各写了两条出路与「要答的」，拍板前不要动手改契约。

---

## 四、两个阻塞（已核实，不是猜）

### 4.1 渲染：开发者工具没装

教师端 **56 屏今天一屏都渲染不出来**，所以「这一屏长对了没有」谁也答不了。十步闸门、探针、接线扫描**全部查不出渲染问题**（CLAUDE.md §6 最后一行写着「上面全部查不出来」）。

| 查了什么 | 结果 |
|---|---|
| 微信开发者工具 | **没装**（四个常见安装目录 + `LOCALAPPDATA` 都查过） |
| `miniprogram-automator` | **声明在 `devDependencies`（`^0.12.1`）、`package-lock.json` 里也有，但没装** —— `npm ls` 回 `(empty)`，`node_modules` 只有 `@scarf`／`argparse`／`js-yaml`／`swagger-ui-dist` 四个。全仓无一处引用它 |
| `tools/web-capture/` | 是给**网页原型**写的；抓的是 `screens/*.html`，与 miniprogram 无关 |

**所以「渲不了」不是被封，是这条路从来没接上。** `appid` 是真的（`wxbda23b3884ae4d69`）、`urlCheck: false`。

**下一步**：装开发者工具（**要人扫码登录一次**，只有人能做），然后用已装的 automator 写一支脚本。**先只做 3 屏样板**（`login`／`home`／`growth-book`）。**挂不进 CI** —— 它要 GUI 与登录。

### 4.2 评价进度自动更新联动：**已解，已实测**（本机起了库）

**答案：`db_growth_record` 一个字都不会被写，而页面当场就变。**

跑通了整条栈（Docker 里的 PG 16 + 测试数据集 + `db/testdata/server/server.mjs` 在 3860），真做两次写入，每次同时读两个来源：

| 做了什么 | 原始表 | `db_growth_record` 的汇总列 | 进度端点（`GET /teacher-evaluations/progress`） |
|---|---|---|---|
| 发布月评（`POST /home-school/month-evals/21/publication`） | `e1` → **`e3`** ✓ | `teacher_month=0` → **`0`（没变）** | `h2` → **`h1`** ✓ |
| 提交学期评价（`PUT /children/3/term-evaluation`） | `c2` → **`c1`** ✓ | `teacher_term=c2` → **`c2`（没变）** | `h2` → **`h1`** ✓ |

**这不是缺陷，是设计，而且契约里写着。** `api/openapi.yaml:6044` 与 `api/action-coverage.tsv` 第 16–19 行：`db_growth_record` 的四个状态列**都是 `no-action`** —— 它们是「齐备判定派生写入」的列，**没有任何客户端动作直接写它们**。而进度端点 `:5542` 明写「**每次读取实时检查原始业务记录，不读取 `db_growth_record` 的测试汇总状态**」。

**所以朝湃那份交接件里的担心是对的，而答案比它预想的更彻底**：那张汇总表连读都没人读。它的值是人工设的夹具，既证明不了联动成立，也影响不了页面 —— 页面的圆点来自实时读原始记录。

**库里改回原样并验过**：`db_month_eval 21 = e1`（`saved_at` 清空）、`db_term_eval 6 = c2`（`submitted_at` 清空）。**62 张表逐张行数与 `STATS.md` 相符，0 处不符。**

### 4.3 起库的办法（下次直接用）

```bash
docker run -d --name hl-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 5432:5432 postgres:16
docker exec hl-pg psql -U postgres -c "CREATE DATABASE hualong_test;"
docker exec -i hl-pg psql -U postgres -d hualong_test -q < db/01_schema.sql
docker exec -i hl-pg psql -U postgres -d hualong_test -q < db/testdata/testdata.sql   # ← 不是 db/02_seed.sql
docker exec -i hl-pg psql -U postgres -d hualong_test -q < db/testdata/verify.sql     # 20 段，每段应 (0 rows)
cd db/testdata && node server/server.mjs                                              # 3860
```

**两个坑，都踩过：**

1. **数据集有两份，名字像、内容差一个数量级。** `db/02_seed.sql` 是演示数据集（3 教师 / 6 幼儿 / 7 家长），`db/testdata/testdata.sql` 才是测试服务端要的那份（12 在职 + 1 离职 / 60 幼儿 / 79 家长 / 6 班）。灌错那份不会报错，只会让你以为 `accounts.env` 里的名字全是错的 —— 我一度就这么报了，**错的是库，不是那个文件**。
2. **Google Drive 路径装不了 npm 包。** `npm install` 会报 `TAR_ENTRY_ERROR` 并写出 0 字节的 `package.json`，报「added N packages」却不报错。解法：在 Drive 之外装好，再把 `node_modules` 复制回来。


---

## 五、那 5 个测试账号：**已实测签票**

`db/testdata/accounts.env` 5 个账号（管理 1／教师 1／家长 3），在跑起来的栈上逐个签过票，**名字与文件里写的逐字一致**：

| surface | id | 签出来的主体 |
|---|---|---|
| `teacher` | 1 | 陈静，`class_id` 1 |
| `admin-pc` | 1 | 园长-谭惠芳 |
| `parent` | 1 | 杨秀兰（家长 1） |
| `parent` | 2 | 陈建华（家长 2，与家长 1 是同一名幼儿的两位监护人） |
| `parent` | 16 | 吴丽娟 |

**顺带量到一条与 CLAUDE.md 措辞不符的事实**：CLAUDE.md §5 写「13 罗慧兰已离职，**登录会失败**」。实测：`POST /dev/session` 会给教师 13 **签出票**（回 200 带 `teacher_status: "s2"`），但**那张票第一次用就失效** —— `GET /auth/session` 回 `session_revoked`。对照教师 1 的票回 200 带完整会话。

所以「登录会失败」**在效果上成立**（凭证撤销真的有效，这是安全属性），只是**测试直发口自己不查 `s2`**：`db/testdata/server/lib/auth.mjs` 第 74 行（请求时）与第 182 行（真登录）都查 `teacher_status !== 's1'`，第 218 行那条 `POST /dev/session` 的分支只查行在不在。要不要给直发口也加这道闸，是个小决定，**本轮没动它**。

**一条我先报错了、再自己推翻的**：我一度说 `accounts.env` 的名字「全对不上」。**错的是我灌的数据集**（灌了演示数据集 `db/02_seed.sql`），那个文件是对的。

**`title_source` 那一列**：我先前说「19 行空」，**也是错的**。实测 **空 0 行**，人工行的出处也全对。那 19 是我从登录页子代理的注释里推的，而它写的是它自己那两行填之前的状态。**这一条无事可做。**


---

## 六、一句话留给下一个人

**契约一个字节没改。** 六张票里四张是决策票，先拍板再动手；顺序永远是 `api/openapi.yaml` → 服务端 → 客户端（CLAUDE.md §2）。
