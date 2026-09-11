### 7.7 ELI10 不在契约里，它是渲染时注入的

Swagger UI 上每个操作那段「说人话」，**来源不是 `openapi.yaml`**，而是：

```
hualong-backend/db/spec/operation-eli10.tsv      一个操作一行，三个固定标签
  ├─ 「幹嘛」    手工写的
  ├─ 「怎麼走」  手工写的
  └─ 「碰到誰」  生成器每次重算（调用: 来自 screen-operations.tsv；影响: 来自 action-registry ∩ screens.tsv）
```

`tools/swagger/pages.mjs` 的 `injectEli10()` 在**每次渲染时**把它拼到 `description` 前面，
契约原文一个字不动。所以**翻 `openapi.yaml` 找不到它**，也不必去找。

为什么这样放（理由与代价都写在那里）：契约是手写的共享权威，`hualong-parent`、
`hualong-admin-pc` 与三端网页原型都读同一份；往里塞 167 行人工中文会让那份文件多一层
与代码无关的维护面。代价就是上面那句 —— 看契约的人不知道有这一层。

**改那两句人话，改 tsv，不改契约。** 改完 `npm run docs:api` 重生成静态站；
本机看的话 `npm run swagger` 每次请求现读，刷新即可。

**`operation-eli10.tsv` 也有生成器，但它保留「幹嘛」「怎麼走」。**
`npm run emit:screens` 会重算 `碰到誰` 与 `derived_from`，手写的那两列原样留着 ——
所以重跑生成器不会抹掉评审结论。起草的草稿在
`.scratch/screen-operations/eli10-drafts/*.json`，`apply-eli10-drafts.mjs` 合并。

---

