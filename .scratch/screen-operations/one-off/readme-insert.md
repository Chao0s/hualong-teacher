**待建：再加两份表，让「按屏幕看 API」成立（2026-09-11 定，未实作）。** 现有 `screens.tsv` 记「哪一屏写不写数据」，**不记操作**，所以看 Swagger 时对不出「某一页要用哪些 API」。要补的是：

| 文件 | 形式 | 一行是什么 |
|---|---|---|
| `screen-operations.tsv` | 生成 + 登记 | 一个屏幕的一个操作 |
| `operation-eli10.tsv` | **手工维护** | 一个操作的一段人话（ELI10：解释给十岁小孩听） |

`screen-operations.tsv` 的外键是契约现成的 `operationId`；契约还没有的操作留空、写目标路径并标未存在，**不编假外键**。生成器是前端的 `tools/scan-wiring.mjs`（「页面 → service → 操作」那段遍历已经在它手里），**它只重写 `source=gen` 的行**；`gen` 行下次不再出现时标 `stale` 并让闸门报红，不静默删。

`operation-eli10.tsv` 的 `碰到誰` 一格两行：`调用:` 来自 `screen-operations.tsv`，`影响:` 来自 `api/action-registry.tsv` 的 `target_table` ∩ 本目录 `screens.tsv` 的 `primary_tables`。

两份各配一个检查文件，`check-all.mjs` 由八步变十步。**上面「手工维护的只有……」那句届时要多列一项。** 决定理由与全部取舍写在 `../../hualong-teacher/decision.md` 的 2026-09-11 一条。

