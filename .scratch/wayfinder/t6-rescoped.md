## Question

**2026-09-12 重新界定** —— 原先点名的三处，实测后**只剩一处**，另两处各有别的原因（更正记在
`docs/audit/proto-vs-table-2026-09-12.md` §4，审计件原文保留作对照）。

### ① `coordination-file-list`（文件列表，综合协调 → 文件列表）—— **唯一剩下的一处**

整页仍是**字面量**：写死的 `CATALOG`，一个 service 都没调。取档端点 `GET /media/files/{file_id}/url`
的客户端那一半已经写好（`services/media.js`），接不上的原因只有一个 —— **目录里每一条都没有真的 `file_id`**。

> 注意：`db/spec/screen-operations.tsv` 上那两行（`listCoordDocuments`／`getCoordDocument`，`source=human`）
> **不是事实，是计划** —— 记的是「该调」。别把它们读成「已经接好了」。

**要做的（顺序不能反）：**

1. 把这一页从 `CATALOG` 改成读 `GET /coordination/documents`（协调文档，k6），七类靠 `?type=` 选。
2. 拿到 `file_refs` 之后，`onDownload` 照 `party-activity-detail` 那一支抄：取短链 → 下载。
   契约 `GET /media/files/{file_id}/url` 明写教师取 k6 会写一笔 `downloaded`。

### ② `teacher-profile`（个人档案）—— 撤掉，不是缺口

姓名**已经**取自会话（`services/profile.js` 头注写着 `session.getSubject().teacher_name`），
走 `utils/` 那一层，所以按「页面→`services/*`」扫不到。**任教班级那行是刻意不画**：
会话的 `scope` 只有 `class_id`，没有班名，教师端也没有端点回本班班名（CLAUDE.md §8「没有数据源就不要渲染它」）。
**无事可做。**

### ③ `teacher-term-form`（填写学期评价）—— 撤掉，是服务端的事

页头注原先写的理由是错的（已改）。实测 `GET /children/{child_id}/term-evaluation` **回** `file_id`，
空的原因是 `db_file_ref` 里 `owner_object='db_term_eval'` 一行都没有。

真正接不上的是**相册那一侧**：G28（2026-08-01 已决，按 E7）定「相册 = 该幼儿有份的那些 moment 的
全部照片，靠 `db_moment_upload` 筛 moment」，而 `GET /moments` 的 `child_id` **在 teacher 分支从不读**
（传不存在的 999 都回 200）→ 已登记 **G113**（`hualong-backend/db/GAPS.md`）。**等 G113 拍板。**
