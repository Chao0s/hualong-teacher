## Destination

`db/spec/screen-operations.tsv`（一屏一操作一行，56 屏 142 行）里每一屏要用的操作，在契约里都有落点。达标判据：表里 `no-api`／`planned`／带缺口的 `human` 行全部有结论；四条新登记缺口 G109–G112 各自定夺；原型与契约的差集收敛到「不建」或「误报」两类。

## Notes

- 来源：2026-09-12 的三组原型↔映射表对账（`docs/audit/proto-vs-table-2026-09-12.md`，读 57 页，报 15 missing / 9 invented / 18 unsure）。
- 四条缺口已登记在 `hualong-backend/db/GAPS.md` 的 G109–G112（后端提交 `30adf36`）。**契约一个字节还没改。**
- **本图由 herman925 起、由 herman925 推进。**
- 改动顺序不能反（CLAUDE.md §2）：先 `hualong-backend/api/openapi.yaml`，再服务端，最后客户端；改契约要同步 `api/action-registry.tsv` 与 `docs/API-CONTRACT.md` §15。
- 权威顺序：`DECISIONS.md` > `db/01_schema.sql` > `DATABASE_SPEC.md` > spec 文件 > 原型。
- **「我们自己发明的」9 条不是本图的票。** 每条都追到一份决议或规范节号，要动的是原型，不是契约。
- 决策票用 `/grilling` 与 `/domain-modeling`。
- 名词注解规则见 CLAUDE.md §1：第一次提到 G 编号、表名、端点名要带一句它是什么。

## Decisions so far

<!-- 一条未关。 -->

## Not yet specified

- 原型落后要不要系统性修一次。9 条「契约先行、原型掉了」是同一件事的九个面，一条一条改原型不解决它。
- `screen-operations.tsv` 的 `state` 列每格还带 `?` —— 机器按 handler 名猜的，没人核过。消问号要人逐屏过。
- 对账里 `unsure` 那 18 条（三组各自标了「没把握」）要不要再扫一轮。

## Out of scope

- 地图 #1「接线审计 2026-09-08 的两份审核意见落成可执行工单」—— 另一个目的地，不动它。
- 原型文件本身的排版与样式。