# .scratch/screen-operations —— 起草那 167 句人话的流水线

一次活的中间产物。**权威不在这里**：那 167 句人话的正式副本在
`hualong-backend/db/spec/operation-eli10.tsv`，映射表在
`hualong-backend/db/spec/screen-operations.tsv`。这个目录留下的是**出处**——
每一句是那批起草的、依据什么事实、以及两次翻车的证据。

## 可复用的四个脚本

| 脚本 | 干什么 |
|---|---|
| `eli10-facts.mjs` | 从契约导出 167 个操作的事实 → `eli10-facts.jsonl`。**起草的人只准看这份**，它没写的就不许写 |
| `eli10-drafts/bNN.json` | 一批一个文件。一批写完先过 `verify-drafts.mjs`，再合并 |
| `apply-eli10-drafts.mjs` | 合并进 `operation-eli10.tsv`。普通批次之间撞 key 直接报错退出；`overrides: true` 的修正批次排最后、允许覆盖 |
| `verify-drafts.mjs` | `--merged` 查合并结果（真状态）；传文件名查那一批；`--all` 查全部 |
| `add-manual-rows.mjs` | 把 8 屏人工判定的行写进 `screen-operations.tsv`（6 个 no-api、1 个 human、1 个 planned） |

`eli10-facts.jsonl`（204KB）**不入库**，`.gitignore` 里排掉了 —— 它随时可重生成。
入的是草稿：那才是 167 句人话的出处。

## 跑一遍

```bash
cd ../..
npm run emit:screens                       # 重扫 55 屏 → 两份表（保留手写的那两列）
node .scratch/screen-operations/eli10-facts.mjs
node .scratch/screen-operations/verify-drafts.mjs --merged
```

## `one-off/` —— 已用掉，别再跑

插文档用的脚本，跑过一次就完成了。留着是为了说明「那几段文字是怎么进文件的」
（每段内容也存着：`append-decision.md`、`claude-7.7.md`、`claude-insert.md`、`readme-insert.md`）。

## 撞过的两个坑（写在这里，免得下次再撞）

1. **事实文件漏了 `$ref` 引的参数。** 第一版只认 `p.in`，而
   `$ref: '#/components/parameters/Limit'` 那个对象上没有 `in`，于是 `Limit`／`Cursor`
   整个消失、起草的人不知道能翻页。已起草的 7 条因此漏了翻页／次序，用
   `eli10-drafts/b99-fixes-pagination.json` 补的。
2. **拿草稿当靶子会把已修好的又报一遍。** `b02` 的 10 处提醒里 7 处早被 `b99` 改掉。
   判断「现在还有没有漏」要查**合并后的 tsv**（`--merged`），不是各份草稿。

另：`verify-drafts.mjs` 的「次序／分页有没有提」是**提醒不是闸门**，靠关键词匹配，
会误报。我自己的词表就漏过三次（`升序`、`名册整取`、`降序`），白报三条假警。
