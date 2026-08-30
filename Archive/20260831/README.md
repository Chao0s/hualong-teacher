# 归档：2026-08-31 · 旧教师端小程序工程与它的测试

这一批归档的是**上一版原生小程序工程**，以及只服务于它的测试与校验工具。
归档理由：那一版的页面实现被判定为错的，不再作为施工基准。

同日 `wx-test-home/`（网页原型转出来的预览工程）改名接手 `miniprogram/`，
成为仓库里唯一的小程序工程。经过在 `docs/handoff/` 里的那份交接文档。

---

## 归档了什么

| 路径 | 内容 | 归档前的状态 |
|---|---|---|
| `miniprogram/` | 旧教师端小程序：11 个主包页 + 10 个分包、16 个 service、towxml、共用组件与样式 | 可编译 |
| `tests/` | 34 个 `*.test.mjs` | **733 个测试全部通过**（116 个 suite，约 15 秒） |
| `tools/verify-build.mjs` | 静态编译校验：分包、tabBar、主包 2MB / 整包 20MB 上限、baseUrl 必须 https | 通过 |
| `tools/schema-conformance.mjs` | 校验 `miniprogram/services` 与字段契约 | 通过 |

**归档当天这些东西是好的，不是坏掉才归档的。** 733 个测试写的是已经拍板的行为
（`decision.md`、`docs/DO-NOT-BUILD.md`、ADR-0016），要捡回来时它们仍然成立，
只是没有了被测对象。

## 为什么测试跟着一起走

测试测的是 `miniprogram/services` 这一层 —— 客户端与后端契约的接缝。
新的 `miniprogram/` 是给园方点着看的预览工程，**一个接口都不调**，没有 service 层，
所以这 733 个测试无处可测。留在原地只会变成一句「找不到模块」。

## 要捡回来怎么做

```bash
git mv Archive/20260831/tests tests
git mv Archive/20260831/tools/verify-build.mjs tools/verify-build.mjs
git mv Archive/20260831/tools/schema-conformance.mjs tools/schema-conformance.mjs
```

再把 `package.json` 的这三条加回去：

```json
"test": "node --test \"tests/**/*.test.mjs\"",
"verify:build": "node tools/verify-build.mjs",
"verify:release": "node tools/verify-build.mjs --release",
"verify:schema": "node tools/schema-conformance.mjs"
```

`tests/helpers/seam.mjs` 与那两个工具里的路径常量都指向 `<仓库根>/miniprogram`，
要跟着改成实际位置。

## 留下的三处牵连

1. **`package.json` 的 `devDependencies` 没动。** `miniprogram-ci` 与
   `miniprogram-automator` 只有归档掉的 `verify-build.mjs` 在用，现在没人用了。
   没有顺手删，是因为删了不重跑 `npm install` 会让 `package-lock.json` 对不上，
   CI 的 `npm ci` 会直接失败。要清就连锁文件一起重生成。
2. **`.claude/skills/hualong-api-test`** 的 contract 层仍指向 `miniprogram/services`。
   那个路径现在不存在，该 skill 会「跳过并说明理由」——这是实话，不是路径写错了。
   文件里已写下注释。
3. **`docs/frontend spec files/form-control-spec.md`** 里引用的组件路径
   （`hl-picker-row`、`hl-child-picker`、`form-rows.wxss`）指的都是旧工程，
   现在在 `Archive/20260831/miniprogram/` 下。契约本身仍然有效，实现不在原位了。
