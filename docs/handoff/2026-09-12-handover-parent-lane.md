# 2026-09-12 · 家长端交接 —— 给李棟

**作者 herman925。** 对象仓库 `hualong-parent`。

---

## 悬而未决的那个问题

**`G114`：家长端「四来源报告 union」归谁写。**

四来源 = `db_month_eval` + `db_parent_evaluation` + `db_term_eval` + `db_child_assessment`。
契约 `API-CONTRACT.md` §4 规则 22 **已经把形状定死了**（统一输出 `report_kind + source_id + report_date`，
游标是三者组合，`report_category` 六值先与学期取交集再游标分页，未知类别回 400）。

**缺的是归属，不是设计。** 它跨模块三与模块六，**两边都写会长出两套**。
`ChildAssessmentReport` / `ScaleAggregate` 两个 schema 已是那个形状，**详情可直接复用**。

**这条挂在 `hualong-backend/db/GAPS.md` 的 G114，等你认领。**

---

## 现在的状态

| 项 | 值 |
|---|---|
| 分支 | `main`，HEAD `4799c83`，0 未提交 |
| 文件 | 170 个 |
| **service 层** | **0 个文件** —— 仍是 HTML 原型，还没有 API 层 |
| 契约里的家长端端点 | **14 条 `/parent/...`** |

**14 条端点全在契约里、服务端多数已实作。** 列出来给你对：

```
/parent/children/{child_id}/profile-corrections
/parent/growth-book/sections/{section_id}/submissions
/parent/children/{child_id}/parent-tasks
/parent/children/{child_id}/parent-tasks/{parent_task_id}
/parent/children/{child_id}/parent-tasks/{parent_task_id}/submission
/parent/children/{child_id}/parent-tasks/{parent_task_id}/submission/content-check
/parent/children/{child_id}/parent-tasks/{parent_task_id}/submission/book-inclusion
/parent/children/{child_id}/parent-tasks/{parent_task_id}/read-receipt
/parent/children/{child_id}/task-submissions
/parent/children/{child_id}/evaluations
/parent/children/{child_id}/evaluations/{parent_evaluation_id}
/parent/children/{child_id}/evaluations/{parent_evaluation_id}/content-check
/parent/children/{child_id}/evaluations/{parent_evaluation_id}/photo-sources
/parent/children/{child_id}/evaluations/{parent_evaluation_id}/read-receipt
```

---

## 本机怎么跑（家长端要和教师端对着核）

```bash
docker exec hl-pg psql -U postgres -d hualong_test -tAc "select count(*) from db_child;"   # 60 才算对
cd hualong-backend/db/testdata && node server/server.mjs                                     # 3860
```

**测试帐号写在 `hualong-backend/db/testdata/accounts.env`：**

| 谁 | 值 |
|---|---|
| `PARENT_SURFACE` | `parent` |
| 家长 1 | 杨秀兰（`devSubjectId=1`） |
| **家长 2** | **陈建华（`devSubjectId=2`）—— 与家长 1 是同一名幼儿（1 陈明轩）的另一位监护人** |

**「幼儿 1 在 teacher_id 1 的班上，而 parent_id 1 与 2 都是他的监护人」** —— 这组是刻意造的，
用来验 `caretakers` 的 r1／r2 两条。**核数据时用这一组。**

---

## 两条跟你这一线直接有关的

| 编号 | 内容 |
|---|---|
| **G114** | 上面那个 union 的归属 |
| **§4 规则 22 的回退口径** | 「当前优先 → 无当前回最近结束 → 从未有园历才回全部时间」**整段是写给家长端的**，而 §5.4 只管写入。两处拼不出「放假期间家长打开这一页看到什么」 |

---

## 下一步

**先回一句：G114 这条 union 归家长端（你）还是归教师端。**
归你，我就把 §4 规则 22 的两条 predicate 与 schema 复用点整理给你；归教师端，你这边只做消费。
