# 2026-09-12 · 教师端交接 —— 给朝湃

**作者 herman925。** 仓库 `hualong-teacher`。

---

## 悬而未决的那个问题

**`G117` 要不要现在修：`org.child.transfer` 的登记行缺 B9 要求的四张表 `class_id` 回写**
（`db_child_assessment`、`db_growth_record`、`db_growth_book`、`db_parent_evaluation`）。

漏了它，**转班后综合评估与成长档案会留在旧班，班级报告的分母算错**。
它 2026-08-20 就被写出来了，25 天没人接手 —— 因为它待在一个未进版的目录里，缺口册里没有编号。
现在编号是 G117，写在 `hualong-backend/db/GAPS.md`。

**我不动它，因为那要改登记表与服务端，属于你这一线。**

---

## 现在的状态

| 项 | 值 |
|---|---|
| 分支 | **只有 `main`**（`master` 已删，本地与远端） |
| HEAD | `b1869d3`，0 未提交、0 领先、0 落后 |
| 页面 | 56 页，**已接 service 50 页**，6 页仍是写死的字 |
| CI | GitHub Pages 上次 `completed / success` |
| 线上 | `https://chao0s.github.io/hualong-teacher/api-doc/pages.html` |

**权威是现场跑出来的数**：`npm run scan:wiring` 第一行。

---

## 本机怎么跑

```bash
docker exec hl-pg psql -U postgres -d hualong_test -tAc "select count(*) from db_child;"   # 60 才算对
cd hualong-backend/db/testdata && node server/server.mjs                                     # 3860
双击 launch api-doc.bat                                                                       # 3830
```

**那个 .bat 的四条规矩**（今天用血换来）：

| 规矩 | 为什么 |
|---|---|
| **只跑一次** | 每次跑都停掉重起服务、还开一个浏览器分页。我今天跑了八次 → 243 个分页 + 机器卡死 |
| 脚本驱动时设 `HL_NO_BROWSER=1` | 否则每次多开一个分页 |
| **服务不热载入** | 旧服务吐的码与新的长得一模一样，只是少东西 |
| **`.bat` 注释只准 ASCII** | cmd 用控制台编码读 UTF-8 的 .bat，中文注释被误读 → `'s'`／`'em'`／`'etstat'` is not recognized |

判据：`netstat -ano | grep LISTENING | grep -E ':383[0-7] '` —— 恰好一个，在 3830。

---

## `/pages`（按屏幕看）现在带什么

每个操作行带**五段中文**，各标来源：`幹嘛`／`怎麼走`／`碰到誰`（来自 `operation-eli10.tsv`）、`契约摘要`／`契约原文`（来自 `openapi.yaml`）。

分两组：`① 元素（原型上的東西）` 与 `② API（客戶端調的）`。契约外的行不空着 —— 写清「为什么没有文字 + 调用点 + 它干什么」。

---

## 下一步

**先判 G117**：四笔回写是补进 `also_writes`，还是写成 `side_effects` 的一个具名条目。
前者能被既有的形状闸门检查，后者不能。**判完再动登记表与服务端。**

---

## 另一件不挡你开工的

票 #82 只剩一页：`coordination-file-list` 整页还是写死的字。
