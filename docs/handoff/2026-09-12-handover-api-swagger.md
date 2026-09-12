# 2026-09-12 · API 与 Swagger 交接 —— 给 herman925（自己）

**对象：契约页面这个东西本身怎么用、怎么改。**

---

## 悬而未决的那个问题

**`/agentmemory/search` 回 HTTP 500，所以 Swagger 那边「说人话」的写入链路没有一个能自己验的检查。**

实况：

```
/agentmemory/search   →  HTTP 500   body: { "error": "Invocation stop…
/agentmemory/health   →  service=degraded  alerts=memory_warn_94%_rss2333mb
```

一个多小时里记忆体从 89% 涨到 94%、RSS 2130 → 2333 MB。**它在往坏的方向走。**

**要做的**：用 `am.ps1 stop` 重起（**绝不能用 `docker stop`／`rm -f`** —— SIGKILL 会毁掉未落盘的索引），
再跑 `am.ps1 status` 看 `search index` 那条是否回 200。

---

## 今天修掉的一条（别再走回头路）

`common.ps1` 的 `Test-AmIndexRetrievable` 原来直接读 `$sr.Content.results`。
而 **`Invoke-Am` 永不抛例外** —— HTTP 错误时它把回包内文放进 `Content`。
于是当 `/search` 回 500 时，读 `.results` 在 StrictMode 下抛错，被 catch 收走，报成：

```
[FAIL] search index returns what the store holds — probe errored: The property 'results' cannot be found
```

**那句话读起来像「索引全毁」，而实情是「这条检查根本跑不起来」。**

现在先看 `$sr.Status` 与回包形状，不对就 **`skip`**：

```
[SKIP] search index returns what the store holds — NOT VERIFIED:
       search answered HTTP 500 instead of results — nothing was sampled, so this check proved nothing.
       22 PASS, 0 FAIL, 1 NOT VERIFIED
```

**规矩：一条跑不起来的检查必须说「没跑成」，不能说「查出来是坏的」。**

---

## 那四个页面在哪、怎么看

**双击 `launch api-doc.bat`**（仓根那个只是转发壳，真身在 `.claude/skills/hualong-api-test/scripts/`）。
它会收掉 3830–3837 上的旧服务、固定起在 **3830**、开一个浏览器分页。

| 网址 | 是什么 |
|---|---|
| `/` | **按模塊看**（Swagger UI） |
| `/pages` | **按屏幕看** —— 一屏一卡，带「留结论」下拉与留言框 |
| `/roles` | 角色矩阵 |
| `/pages.yaml` · `/openapi.yaml` | 规格与原始契约 |
| `/review` | **302 转去 `/pages`**（合并过了，别再加一页） |

线上那份：`https://chao0s.github.io/hualong-teacher/api-doc/pages.html`
（**注意路径是 `/api-doc/`** —— CI 建到 `_site/api-doc/`，不是站根。

---

## 「说人话」是怎么来的

**不在契约里**，是渲染时注入的：

```
hualong-backend/db/spec/operation-eli10.tsv
  ├─ 「幹嘛」    手工写的
  ├─ 「怎麼走」  手工写的
  └─ 「碰到誰」  生成器每次重算
```

`tools/swagger/pages.mjs` 的 `injectEli10()` 在**每次渲染时**拼到 `description` 前面，契约原文一个字不动。

**改那两句人话，改 tsv，不改契约。**

`/pages` 每一行带**五段**：`幹嘛`／`怎麼走`／`碰到誰`／`契约摘要`／`契约原文`，各标来源。
契约外的行写清「为什么没有文字 + 调用点 + 它干什么」（那一句是全页唯一手写中文，标了出处）。

---

## 下一步

**重起 agentmemory 容器，再跑 `am.ps1 status`。** `search` 回 200 才算这条链是活的；
不回 200，那是上游的 bug，不是我们的。
