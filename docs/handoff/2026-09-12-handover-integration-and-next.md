# 2026-09-12 · 整体合并结果与下一步

**作者 herman925。** 覆盖两个仓库、三端、以及今天所有未决的事。

---

## 悬而未决的那个问题

**今天合并算不算完成？—— 算，但有三件挂在账上，都不挡别人开工。**

| # | 挂着什么 | 归谁 |
|---|---|---|
| 1 | **G117**：转班缺 B9 要求的四张表 `class_id` 回写，**班级报告分母会算错** | 朝湃（教师端／服务端） |
| 2 | **G114**：家长端四来源报告 union 归谁写 | 李棟（家长端） |
| 3 | **agentmemory 的 `/search` 回 500** + 记忆体 94% | herman925 |

---

## 合并结果

| 仓库 | 分支 | HEAD | 工作区 |
|---|---|---|---|
| `hualong-teacher` | **只有 `main`** | `b1869d3` | 0 未提交、0 领先、0 落后 |
| `hualong-backend` | `main` | `1815516` | 0 未提交、0 领先、0 落后 |

**双方产出已互相并入**：朝湃的 `70d04cb`（197 檔「merge reviewed work onto main」）含我今天的全部程式工作；
我的文件提交 cherry-pick 上去（补丁 ID 逐字相同）。

**`master` 已删**（本地与远端）。**三处必须同时指 `main`**：

```
.github/workflows/pages.yml 的 branches: [main]
GitHub repo 设定的默认分支            → main
GitHub Pages 站点的 source branch     → main   ← 这一处在仓库外面，grep 不到
```

**删 `master` 时我只改了第一处，`deploy` 就失败了**（`build` 全绿，失败信息没提设定）。修好了、CI 重跑绿。

线上：`https://chao0s.github.io/hualong-teacher/api-doc/pages.html` —— **路径是 `/api-doc/`**。

---

## 今天做完的

| 事 | 证据 |
|---|---|
| `/pages` 每行带五段中文 | `幹嘛`／`怎麼走`／`碰到誰`／`契约摘要`／`契约原文`，各标来源（commit `ff67417`） |
| `probes` 成为第 11 层 | 18 支探针 + 7 组越权，跑出 `1765 checks passed, 4 failed, 0 silent` |
| 死锁修好 | `postDevSession`／`postSession` 缺 `skipAuthRetry`，登录 401 走进重登分支等自己（`7267164`） |
| 探针的静默通过修好 | `withTimeout(...).unref()` 让进程静默 exit 0 —— 一支专测死锁的探针报不出死锁（`5847552`） |
| 探针的时区错修好 | 把 UTC 盖上 `+08:00`，485 分钟 = 480 + 5，两条断言必然红而服务端是对的（`a02396f`） |
| `.scratch/` 那条线画了 | 67 忽略、5 删、49 追踪（`a3e1d5d`） |
| `launch api-doc.bat` 修好 | 先收旧服务、固定 3830、只准 ASCII、`HL_NO_BROWSER`（`80b6282`／`809e013`） |
| 缺口册收口 | G56 收口、G114–G118 新登记、契约两处矛盾的注释改正（`db219cb`） |
| 三节教训进 `CLAUDE.md` | §7.13 不热载入／§7.14 .bat 不装非 ASCII／§7.15 一个设定两处写（`63d23a6`／`3c4515a`） |
| 技能更新 | `hualong-api-test` 加「The launcher, and the server it owns」一节（`b1869d8`／`b1869d3`） |

---

## agentmemory 出了什么

**写入成功、读取失败，而验证这件事的那条检查本身也是坏的。**

```
memory_save  ×4   →  四条都回 success: true 并给了 id
memory_search     →  0 条
memory_recall     →  0 条

/agentmemory/search   →  HTTP 500
/agentmemory/health   →  service=degraded  alerts=memory_warn_94%_rss2333mb
```

存储里 `memories 35`、`sessions 27` —— **东西在，读不出来**。

**修掉的一半**：`common.ps1` 的 `Test-AmIndexRetrievable` 原来把「回包形状不对」读成「索引全毁」。
现在先看 HTTP 状态与形状，不对就 `skip` —— `22 PASS, 0 FAIL, 1 NOT VERIFIED`，说法从「坏了」变成「没跑成」。

**没修的那一半**：`/search` 那个 500 是服务端的。要重起容器（**用 `am.ps1 stop`，绝不能用 `docker stop`／`rm -f`**），
再跑 `status` 看它是否回 200。

---

## DB 资料要不要放进仓库 —— **已经在里面了**

| 檔案 | 是什么 | 大小 |
|---|---|---|
| `db/01_schema.sql` | 建表，62 张，每列带中文注释 | 157K |
| `db/testdata/testdata.sql` | **测试数据集**：12 在职+1 离职教师／60 幼儿／79 家长／6 班 | 2.1M |
| `db/02_seed.sql` | 演示数据集（3 教师／6 幼儿） | 37K |
| `db/testdata/accounts.env` | 帐号名册 | — |
| `db/testdata/README.md`、`STATS.md` | 怎么灌、灌完该看到什么 | — |
| `db/testdata/generate.mjs` + `gen/*.mjs` | 产生 `testdata.sql` 的**产生器** | — |

**缺的只有一样：没有 docker 配置**（没有 `Dockerfile`、没有 `docker-compose.yml`）。
现在起库的四行写在 `db/testdata/README.md` 里，要人手打。

**结论：资料不用另外放。要放的是「一行就起好」的 `docker-compose.yml`** —— 你说了先放着，后面再补。
**建档器用 wayfinder 规划。**

---

## 下一步（按顺序）

1. **重起 agentmemory 容器** → 跑 `am.ps1 status` → 看 `/search` 是否回 200
2. **朝湃判 G117**、**李棟回 G114 归谁** —— 这两条不挡别人开工，但要在动登记表前定
3. **`docker-compose.yml`**（先规划、后补）
4. 票 #82 只剩 `coordination-file-list` 一页
