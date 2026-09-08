# 学期评价与综合评估：契约 schema 与 DDL 逐列对账

GitHub issue #11（L3）。只读研究，不改业务代码，不改 `db/GAPS.md`。

| 来源 | 文件 | 版本 |
|---|---|---|
| 契约 | `D:/hualong-backend/api/openapi.yaml`（paths 第 5006–5266 行，schemas 第 8192–8392 行） | 后端 HEAD `2cfa950` |
| DDL | `D:/hualong-backend/db/01_schema.sql`：`db_scale_item`（1254）、`db_child_assessment`（1343）、`db_child_assessment_item`（1380）、`db_term_eval`（1426） | 同上 |
| 范围规则 | `D:/hualong-backend/db/spec/scope-rules.json`（teacher：derived / scoped / computed） | 同上 |

**结论先说**：8 个端点共 119 个字段位。一致 41，契约多（派生）13，DDL 多（契约没暴露）62，类型不同 3，名字不同 0。
真正要登记的差异 7 条（§10），全部是约束或口径差，没有一处「列名对不上」。

## 0. 读表说明

| 项 | 说明 |
|---|---|
| 判定取值 | 一致 / 契约多（派生，注明来源）/ DDL 多（契约没暴露）/ 类型不同 / 名字不同 |
| NOT NULL 列 | 写 DDL 的可空性；契约 `required` 或 `[T,'null']` 与它不同时在备注里写 |
| `items` 外壳 | `{ items: [...] }` 与 `domains[]` 之类的数组外壳不计字段，只计叶子 |
| teacher 的 derived | `school_id`、`class_id`、`teacher_id`（scope-rules.json `roles.teacher.derived`）：客户端不能发，服务端从会话设值 |
| teacher 的 scoped | `child_id`、`term_id`：客户端可发，服务端在同一 predicate 内重验 |
| computed | `db_child_assessment.required_count` / `completed_count`（scope-rules.json `computed.columns`）：所有角色不可写 |
| 时间戳 | 所有 `*_at` 归 derived（API-CONTRACT §1.2），契约 `Timestamp` = `[string,'null']` 带 `+08:00` |

## 1. `GET /term-evaluations` → `{ items: TermEvaluationProgress[] }`

本班学期评估进度（「教师评价」页的学期评估栏）。名册左连接 `db_term_eval`，无行即 c2。

| 契约字段 | DDL 表.列 | 契约类型 | DDL 类型 | NOT NULL | 判定 |
|---|---|---|---|---|---|
| child_id | db_term_eval.child_id（无行时来自 db_child.child_id） | integer，required | INT | 是 | 一致 |
| child_name | db_child.child_name | string ≤50，required | VARCHAR(50) | 是 | 契约多（派生：JOIN db_child） |
| term_eval_id | db_term_eval.term_eval_id | [integer,null] | INT PK | 是 | 一致（null = 名册无行） |
| term_eval_status | db_term_eval.term_eval_status | enum c1/c2，required | VARCHAR(4) CHECK IN (c1,c2) | 是 | 一致（无行时契约回 c2） |
| submitted_at | db_term_eval.submitted_at | Timestamp | TIMESTAMP | 否 | 一致 |
| — | db_term_eval.school_id | — | INT | 是 | DDL 多（derived 上下文） |
| — | db_term_eval.class_id | — | INT | 是 | DDL 多（derived 上下文） |
| — | db_term_eval.teacher_id | — | INT | 是 | DDL 多（进度行刻意不带） |
| — | db_term_eval.term_id | — | VARCHAR(20) | 是 | DDL 多（只回当前学期，契约无 term_id 参数） |
| — | db_term_eval.eval_text | — | VARCHAR(500) | 否 | DDL 多（进度行不带正文） |
| — | db_term_eval.created_at | — | TIMESTAMP | 是 | DDL 多 |
| — | db_term_eval.updated_at | — | TIMESTAMP | 是 | DDL 多 |

小计 12：一致 4，派生 1，DDL 多 7。

## 2. `GET /children/{child_id}/term-evaluation` → `TermEvaluation`

本人对该幼儿本学期的学期评估。唯一键 `teacher_id + child_id + term_id`（B9）。

| 契约字段 | DDL 表.列 | 契约类型 | DDL 类型 | NOT NULL | 判定 |
|---|---|---|---|---|---|
| term_eval_id | db_term_eval.term_eval_id | integer，required | INT PK | 是 | 一致 |
| class_id | db_term_eval.class_id | integer | INT | 是 | 一致（契约未列 required，DDL NOT NULL） |
| child_id | db_term_eval.child_id | integer，required | INT | 是 | 一致 |
| teacher_id | db_term_eval.teacher_id | integer | INT | 是 | 一致（契约未列 required，DDL NOT NULL） |
| term_id | db_term_eval.term_id | string，required，无 maxLength | VARCHAR(20) | 是 | 一致（契约漏 `maxLength: 20`；同文件另有 5 处 term_id 写了，在第 5744、6438、6537、6897、6996 行，漏的共 4 处） |
| eval_text | db_term_eval.eval_text | [string,null] ≤500 | VARCHAR(500) | 否 | 一致 |
| file_id | db_file_ref.file_id WHERE owner_object='db_term_eval' AND owner_id=term_eval_id | integer[] | INT（多行） | — | 契约多（派生：db_file_ref 聚合，本表无列） |
| term_eval_status | db_term_eval.term_eval_status | enum c1/c2，required | VARCHAR(4) CHECK | 是 | 一致 |
| submitted_at | db_term_eval.submitted_at | Timestamp | TIMESTAMP | 否 | 一致 |
| — | db_term_eval.school_id | — | INT | 是 | DDL 多（derived 上下文） |
| — | db_term_eval.created_at | — | TIMESTAMP | 是 | DDL 多 |
| — | db_term_eval.updated_at | — | TIMESTAMP | 是 | DDL 多 |

小计 12：一致 8，派生 1，DDL 多 3。

## 3. `PUT /children/{child_id}/term-evaluation` ← `TermEvaluationWrite`（响应 `TermEvaluation`，见 §2）

提交学期评估，一次写成 c1。`additionalProperties: false`。

| 契约字段 | DDL 表.列 | 契约类型 | DDL 类型 | NOT NULL | 判定 |
|---|---|---|---|---|---|
| eval_text | db_term_eval.eval_text | string，1–500，**required** | VARCHAR(500) | **否** | 一致（类型）。**约束差**：契约必填，DDL 可空，且无 CHECK 把 c1 与非空正文绑在一起 → D2 |
| file_id | db_file_ref(file_id, owner_object='db_term_eval', owner_id, usage_key) | integer[] | INT + VARCHAR(64) + INT + VARCHAR(32) | 是 | 契约多（写到 db_file_ref）。`usage_key` 契约未约定，DDL 默认 `'attachment'` → D3 |
| — | db_term_eval.school_id | — | INT | 是 | DDL 多（derived，服务端设值） |
| — | db_term_eval.class_id | — | INT | 是 | DDL 多（derived） |
| — | db_term_eval.teacher_id | — | INT | 是 | DDL 多（derived；2026-08-20 由 scoped 移入） |
| — | db_term_eval.term_id | — | VARCHAR(20) | 是 | DDL 多（契约：由当前学期派生；scope-rules：scoped → D7） |
| — | db_term_eval.term_eval_status | — | VARCHAR(4) DEFAULT 'c2' | 是 | DDL 多（服务端写 c1；DDL 默认 c2 没有写入者，见 G46） |
| — | db_term_eval.submitted_at | — | TIMESTAMP | 否 | DDL 多（§1.2 服务端盖） |
| — | db_term_eval.created_at | — | TIMESTAMP | 是 | DDL 多 |
| — | db_term_eval.updated_at | — | TIMESTAMP | 是 | DDL 多 |

小计 10：一致 1，派生 1，DDL 多 8。

## 4. `GET /child-assessments` → `{ items: ChildAssessmentProgress[] }`

本班综合评估进度（124 题量表），本页三态由 `completed_count` / `required_count` 表达。

| 契约字段 | DDL 表.列 | 契约类型 | DDL 类型 | NOT NULL | 判定 |
|---|---|---|---|---|---|
| child_id | db_child_assessment.child_id（无行时 db_child.child_id） | integer，required | INT | 是 | 一致 |
| child_name | db_child.child_name | string ≤50，required | VARCHAR(50) | 是 | 契约多（派生：JOIN db_child） |
| child_assessment_id | db_child_assessment.child_assessment_id | [integer,null] | INT PK | 是 | 一致（null = 无行） |
| scale_code | db_child_assessment.scale_code | [string,null] ≤64 | VARCHAR(64) | 是 | 一致（null 仅在无行时） |
| scale_version | db_child_assessment.scale_version | [string,null] ≤32 | VARCHAR(32) | 是 | 一致 |
| required_count | db_child_assessment.required_count | integer，**required** | INT DEFAULT 0 | 是 | 一致（computed）。**口径缺**：无行时契约仍要求回值，却没说回 0 还是现役题数 124 → D5 |
| completed_count | db_child_assessment.completed_count | integer，required | INT DEFAULT 0 | 是 | 一致（computed；无行回 0，契约已写明） |
| child_assessment_status | db_child_assessment.child_assessment_status | enum c1/c2，required | VARCHAR(4) CHECK | 是 | 一致 |
| submitted_at | db_child_assessment.submitted_at | Timestamp | TIMESTAMP | 否 | 一致 |
| — | db_child_assessment.school_id | — | INT | 是 | DDL 多（derived） |
| — | db_child_assessment.class_id | — | INT | 是 | DDL 多（derived） |
| — | db_child_assessment.teacher_id | — | INT | 是 | DDL 多 |
| — | db_child_assessment.term_id | — | VARCHAR(20) | 是 | DDL 多（只回当前学期） |
| — | db_child_assessment.created_at | — | TIMESTAMP | 是 | DDL 多 |
| — | db_child_assessment.updated_at | — | TIMESTAMP | 是 | DDL 多 |

小计 15：一致 8，派生 1，DDL 多 6。

## 5. `GET /child-assessments/class-report` → `ChildAssessmentClassReport`

班级五领域均分，只统计 c1。全部数值即时聚合。

| 契约字段 | DDL 表.列 | 契约类型 | DDL 类型 | NOT NULL | 判定 |
|---|---|---|---|---|---|
| class_id | db_child_assessment.class_id | integer，required | INT | 是 | 一致（值来自会话上下文） |
| term_id | db_child_assessment.term_id | string，required | VARCHAR(20) | 是 | 一致（值为 $current_term；契约漏 maxLength） |
| assessed_child_count | — | integer，required | — | — | 契约多（派生：COUNT(DISTINCT child_id) WHERE child_assessment_status='c1'） |
| domains[].code | — | string ≤16，required | — | — | 契约多（派生：db_child_assessment_item.item_id 的前缀，如 `H`） |
| domains[].item_count | — | integer，required | — | — | 契约多（派生：COUNT(db_child_assessment_item.score)，只数已评） |
| domains[].average | — | [number,null]，required | — | — | 契约多（派生：AVG(db_child_assessment_item.score)，整域未评回 null） |

小计 6：一致 2，派生 4，DDL 多 0（聚合端点，不对应单行）。

## 6. `GET /children/{child_id}/child-assessment` → `ChildAssessmentDetail`

`allOf: [ChildAssessmentProgress, { items: ChildAssessmentItem[] }]`。前 9 行与 §4 相同，只列 §4 没有的。

| 契约字段 | DDL 表.列 | 契约类型 | DDL 类型 | NOT NULL | 判定 |
|---|---|---|---|---|---|
| （§4 的 9 个字段） | db_child_assessment.* / db_child.child_name | — | — | — | 一致 8，派生 1（同 §4） |
| items[].item_id | db_child_assessment_item.item_id | string **≤16**，required | **VARCHAR(32)** | 是 | 类型不同（长度 16 vs 32）→ D1 |
| items[].score | db_child_assessment_item.score | integer 1–5，required | SMALLINT CHECK 1..5 | 是 | 一致 |
| — | db_child_assessment.school_id / class_id / teacher_id / term_id | — | INT ×3 / VARCHAR(20) | 是 | DDL 多 ×4（同 §4） |
| — | db_child_assessment.created_at / updated_at | — | TIMESTAMP | 是 | DDL 多 ×2 |
| — | db_child_assessment_item.child_assessment_item_id | — | INT PK | 是 | DDL 多 |
| — | db_child_assessment_item.child_assessment_id | — | INT FK | 是 | DDL 多（外层已给主记录 id） |
| — | db_child_assessment_item.created_at / updated_at | — | TIMESTAMP | 是 | DDL 多 ×2 |

小计 21：一致 9，派生 1，类型不同 1，DDL 多 10。

## 7. `PUT /children/{child_id}/child-assessment/items/{item_id}` ← `ChildAssessmentItemWrite`（响应 `ChildAssessmentProgress`，见 §4）

逐题增量保存。首次评分建主记录 NONE→c2；末题 c2→c1。

| 契约字段 | DDL 表.列 | 契约类型 | DDL 类型 | NOT NULL | 判定 |
|---|---|---|---|---|---|
| child_id（path） | db_child_assessment.child_id | integer | INT | 是 | 一致（scoped，服务端重验在本班 e1） |
| item_id（path） | db_child_assessment_item.item_id | string **≤16** | **VARCHAR(32)** | 是 | 类型不同（长度）→ D1。DDL 对 db_scale_item 无 FK，合法性由应用层查 → D6 |
| score（body） | db_child_assessment_item.score | integer 1–5，required | SMALLINT NOT NULL CHECK 1..5 | 是 | 一致 |
| — | db_child_assessment.school_id / class_id / teacher_id | — | INT | 是 | DDL 多 ×3（derived，首次评分建行时设值） |
| — | db_child_assessment.term_id | — | VARCHAR(20) | 是 | DDL 多（$current_term） |
| — | db_child_assessment.scale_code | — | VARCHAR(64) | 是 | DDL 多（服务端绑现役量表）。**值不一致**：契约写 `guide` v1.0，DDL 注释与数据集是 `guide-scale` / `v1` → D4 |
| — | db_child_assessment.scale_version | — | VARCHAR(32) | 是 | DDL 多（同上） |
| — | db_child_assessment.required_count | — | INT | 是 | DDL 多（computed，随绑定版本 = 124） |
| — | db_child_assessment.completed_count | — | INT | 是 | DDL 多（computed = 题项行数） |
| — | db_child_assessment.child_assessment_status | — | VARCHAR(4) | 是 | DDL 多（由 completed_count 派生） |
| — | db_child_assessment.submitted_at | — | TIMESTAMP | 否 | DDL 多（c2→c1 时盖） |
| — | db_child_assessment.created_at / updated_at | — | TIMESTAMP | 是 | DDL 多 ×2 |
| — | db_child_assessment_item.child_assessment_item_id | — | INT PK | 是 | DDL 多 |
| — | db_child_assessment_item.child_assessment_id | — | INT FK | 是 | DDL 多（由 child_id + 当前学期解出） |
| — | db_child_assessment_item.created_at / updated_at | — | TIMESTAMP | 是 | DDL 多 ×2 |

小计 19：一致 2，类型不同 1，DDL 多 16。

## 8. `GET /children/{child_id}/child-assessment/report` → `ChildAssessmentReport`

个人报告：五领域均分 + 逐题明细，零文字分析。

| 契约字段 | DDL 表.列 | 契约类型 | DDL 类型 | NOT NULL | 判定 |
|---|---|---|---|---|---|
| child_assessment_id | db_child_assessment.child_assessment_id | integer，required | INT PK | 是 | 一致 |
| child_id | db_child_assessment.child_id | integer，required | INT | 是 | 一致 |
| term_id | db_child_assessment.term_id | string，required | VARCHAR(20) | 是 | 一致（契约漏 maxLength） |
| scale_code | db_child_assessment.scale_code | string ≤64，required | VARCHAR(64) | 是 | 一致 |
| scale_version | db_child_assessment.scale_version | string ≤32，required | VARCHAR(32) | 是 | 一致 |
| submitted_at | db_child_assessment.submitted_at | Timestamp | TIMESTAMP | 否 | 一致 |
| domains[].code | — | string ≤16 | — | — | 契约多（派生：item_id 前缀） |
| domains[].item_count | — | integer | — | — | 契约多（派生：COUNT 已评题） |
| domains[].average | — | [number,null] | — | — | 契约多（派生：AVG(score)） |
| total_average | — | [number,null]，required | — | — | 契约多（派生：全部已评题 AVG(score)） |
| items[].item_id | db_child_assessment_item.item_id | string ≤16 | VARCHAR(32) | 是 | 类型不同（长度）→ D1 |
| items[].score | db_child_assessment_item.score | integer 1–5 | SMALLINT CHECK | 是 | 一致 |
| — | db_child_assessment.school_id / class_id / teacher_id | — | INT | 是 | DDL 多 ×3 |
| — | db_child_assessment.required_count / completed_count / child_assessment_status | — | INT / INT / VARCHAR(4) | 是 | DDL 多 ×3。**有影响**：报告不带完成态，scope 也不过滤 c1，草稿也出报告且客户端分不出 → D8 |
| — | db_child_assessment.created_at / updated_at | — | TIMESTAMP | 是 | DDL 多 ×2 |
| — | db_child_assessment_item.child_assessment_item_id / child_assessment_id | — | INT | 是 | DDL 多 ×2 |
| — | db_child_assessment_item.created_at / updated_at | — | TIMESTAMP | 是 | DDL 多 ×2 |

小计 24：一致 7，派生 4，类型不同 1，DDL 多 12。

## 9. 附录：`db_scale_item` 对 `ScaleItem`

issue 点名了这张表，但它的端点 `GET /scales/{scale_code}/{scale_version}` 不在 8 个端点里。单独列，不计入主计数。

| 契约字段 | DDL 表.列 | 契约类型 | DDL 类型 | NOT NULL | 判定 |
|---|---|---|---|---|---|
| item_id | db_scale_item.item_id | string ≤16，required | VARCHAR(32) | 是 | 类型不同（长度）→ D1 |
| item_name | db_scale_item.item_name | string ≤100，required | VARCHAR(100) | 是 | 一致 |
| question | db_scale_item.question | string，required | TEXT | 是 | 一致 |
| item_type | db_scale_item.item_type | enum likert/measurement，required | VARCHAR(16) CHECK 同值域 | 是 | 一致 |
| anchors | db_scale_item.anchors | object，**required** | JSONB | **否** | 一致（类型）。约束差：契约必填，DDL 可空；现役 124 行全非空 |
| anchored_levels | db_scale_item.anchored_levels | integer[] | JSONB | 否 | 一致 |
| inferred_levels | db_scale_item.inferred_levels | integer[] | JSONB | 否 | 一致 |
| — | db_scale_item.scale_item_id | — | INT PK | 是 | DDL 多 |
| — | db_scale_item.scale_code / scale_version | — | VARCHAR(64) / VARCHAR(32) | 是 | DDL 多 ×2（在外层 `Scale` 暴露，非缺口） |
| — | db_scale_item.measurement_note | — | TEXT | 否 | DDL 多（**G27 说仍须显示给教师**）→ D9 |
| — | db_scale_item.reference_table | — | JSONB | 否 | DDL 多（同上）→ D9 |
| — | db_scale_item.created_at / updated_at | — | TIMESTAMP | 是 | DDL 多 ×2 |

附录小计 14：一致 6，类型不同 1，DDL 多 7。

## 10. 计数与差异清单

### 10.1 计数（8 个端点，不含附录）

| 端点 | 字段位 | 一致 | 派生 | DDL 多 | 类型不同 | 名字不同 |
|---|---|---|---|---|---|---|
| §1 GET /term-evaluations | 12 | 4 | 1 | 7 | 0 | 0 |
| §2 GET term-evaluation | 12 | 8 | 1 | 3 | 0 | 0 |
| §3 PUT term-evaluation | 10 | 1 | 1 | 8 | 0 | 0 |
| §4 GET /child-assessments | 15 | 8 | 1 | 6 | 0 | 0 |
| §5 GET class-report | 6 | 2 | 4 | 0 | 0 | 0 |
| §6 GET child-assessment | 21 | 9 | 1 | 10 | 1 | 0 |
| §7 PUT items/{item_id} | 19 | 2 | 0 | 16 | 1 | 0 |
| §8 GET report | 24 | 7 | 4 | 12 | 1 | 0 |
| **合计** | **119** | **41** | **13** | **62** | **3** | **0** |

62 个 DDL 多里，49 个是 derived / computed / 时间戳，契约刻意不暴露，不是缺口。剩下 13 个（§8 的 3 个完成态列、§7 的 scale_code / scale_version 值、§1 的 eval_text 等）在下面逐条判。

### 10.2 差异清单（建议登记到 `db/GAPS.md` 的措辞）

编号 D1–D9 是本文件内部编号。**登记时取 `db/GAPS.md` 当时最小的空号，不要照抄这里写下的起点。**

本文件原先写「接 G75 起编」，2026-09-09 当天就作废了两次：G74 被 F27 的作者撤回端点缺口占用，G75 被「`downloaded` 事件一笔都不带 `file_id`」占用（契约 v0.12 那一轮），G84 被「`/library/cases` 漏筛三个参数」占用（v0.13 那一轮）。**预留一段号码是靠不住的** —— 两轮并行时，先落地的那一轮就会占掉它。

| # | 差异 | 建议登记措辞 |
|---|---|---|
| D1 | `item_id` 长度：契约 `maxLength: 16`（`ChildAssessmentItem`、`ScaleItem`、path 参数三处），DDL `VARCHAR(32)`（`db_child_assessment_item.item_id`、`db_scale_item.item_id`）。现役 124 题最长 6 字符，今天不咬人 | **G75 · `item_id` 契约 16、DDL 32，两边各自成立 —— GAP**。三处契约 `maxLength: 16` 与两张表的 `VARCHAR(32)` 不同。现役最长 `S2-3-5` 6 字符。定一边：把契约改 32，或把 DDL 收到 16 并加 CHECK。任一边改完在 `check-all.mjs` 加一项比对 openapi `maxLength` 与 DDL 长度 |
| D2 | `db_term_eval.eval_text` 可空，而 `TermEvaluationWrite.eval_text` required 且 minLength 1；c1 行可以没有正文，DDL 不拦 | **G76 · `db_term_eval` 没有「c1 必有正文」的约束 —— GAP**。E6 定 eval_text 是唯一内容列，契约提交时必填，但列可空且无 CHECK。加 `CHECK (term_eval_status='c2' OR eval_text IS NOT NULL)`；若 G46 那格判定 c2 永不写入，直接改 NOT NULL |
| D3 | `TermEvaluationWrite.file_id[]` 落到 `db_file_ref(owner_object='db_term_eval')`，契约未约定 `usage_key`，DDL 默认 `'attachment'`。与 G72 同型 | **G77 · `db_term_eval` 照片引用的 `usage_key` 未约定 —— GAP**。与 G72（家长提交附件）同型。定一个值（建议沿用 `image`）写进契约 §3 端点描述。`image` 已在 `db_file_ref.usage_key` 的枚举注释里（`db/01_schema.sql` 第 528 行），DDL 不必动 |
| D4 | 现役量表的编码值：契约 `PUT items` 描述写「现役 `guide` v1.0」；DDL 注释 `guide-scale` / `v1`，数据集 124 行也是 `guide-scale` / `v1` | **G78 · 现役量表编码契约与 DDL 不同名 —— GAP**。契约 `guide` v1.0 vs DDL/数据集 `guide-scale` / `v1`。以数据集为准改契约描述；同时把「现役版本」写到一个可读的位置（建议 `db/rubric/` 的清单），服务端不再硬编码 |
| D5 | `ChildAssessmentProgress.required_count` required，但名册无行时没有绑定版本，契约没说回 0 还是回现役题数 | **G79 · 无主记录时 `required_count` 回什么，契约没说 —— GAP**。契约的 `ChildAssessmentProgress.description`（第 8254–8258 行）已把 `0`（含 `child_assessment_id=null`）判为未完成，所以未定的只是无行时 `required_count` 带什么值 —— 那一格没有绑定版本可解释。定：无行回现役量表题数（124），并写进 schema 描述 |
| D6 | `db_child_assessment_item.item_id` 对 `db_scale_item` 无 FK；题号合法性只靠服务端查 `(scale_code, scale_version, item_id)` | **G80 · 逐题分的题号没有 DB 级约束 —— GAP（已知并接受可选）**。四层层级刻意不落表（§2.6），但 `(child_assessment_id, item_id)` 到 `db_scale_item` 的对应只在应用层。可加复合 FK `(scale_code, scale_version, item_id)`，代价是题项表要多抄两列；或明文接受 |
| D7 | `scope-rules.json` 把 teacher 的 `term_id` 归 scoped；契约三个端点写「学期由服务端派生，无 term_id 参数」。`TermEvaluationWrite` / `ChildAssessmentItemWrite` `additionalProperties: false`，derived 字段入体回 422；scope-rules `tiers.derived` 说「一律忽略，不报错」 | **G81 · derived 字段入请求体：契约回 422、scope-rules 说忽略 —— GAP**。两份权威文件对同一行为给了两种答案。定一种：改 scope-rules `tiers.derived` 的措辞，或把写入 schema 的 `additionalProperties: false` 去掉 |
| D8 | `ChildAssessmentReport` 不带 `child_assessment_status` / `completed_count` / `required_count`，且 `x-hualong-scope` 不过滤 c1；班级报告只统计 c1，个人报告草稿也出 | **G82 · 个人综合评估报告不区分草稿 —— GAP**。§4 规则 22 的报告流读 c1；本端点 scope 无状态过滤，schema 也不回完成态，客户端无法区分「124 题的报告」与「评了 3 题的报告」。定：scope 加 `child_assessment_status='c1'`（草稿回 404），或 schema 补三列 |
| D9 | `db_scale_item.measurement_note` / `reference_table` 契约 `ScaleItem` 不暴露；G27 与列注释都写「仍须显示给教师」 | **G83 · G27 要求显示的参考表，契约没有暴露 —— GAP**。`ScaleItem` 缺 `measurement_note` 与 `reference_table`。补两个可空字段；H1-1-1 之外回 null |

D1、D2、D4、D5、D8、D9 是契约或 DDL 要改一边的差异（6 条）；D3、D6、D7 是口径未定（3 条）。合计 9 条，其中 D6 可判「已知并接受」。

## 11. 附带观察：实作与契约不符（不在本 issue 范围）

对账时顺手读了 `db/testdata/server/routes/teacher.mjs` 第 997–1156 行。这些是实作对契约，不是契约对 DDL，留给 `probe-assessment` 去钉：

| 端点 | 契约 | 实作 |
|---|---|---|
| PUT term-evaluation | INSERT，回 201 | UPDATE 已有行，回 200；名册幼儿无行时 404 |
| GET /term-evaluations、GET /child-assessments | 名册 LEFT JOIN，无行即 c2 | INNER JOIN，无行的幼儿不出现；另接受契约没有的 `?term_id` |
| GET term-evaluation | `TermEvaluation`（含 file_id[]） | `SELECT t.*`，多回 school_id / created_at / updated_at，无 file_id |
| PUT items/{item_id} | 回 `ChildAssessmentProgress`；首次评分建主记录 | 回题项行；只找已有的 c2 主记录，无则 404 |
| GET report | `domains[].code / average`，有 total_average、scale_code、items | 字段名 `domain / domain_score`，无 total_average、scale_code、items |
| GET class-report | `ChildAssessmentClassReport`，只统计 c1 | 回逐幼儿逐领域行，不过滤 c1 |
| GET /scales | `ScaleItem` | 多回 `measurement_note`（正好是 D9 要补的） |
