# 產品需求文檔 (PRD)：微信小程序「六層全鏈路接線與未知契約審計器」v2.0

- **文檔名稱**：Mini-Program Full-Chain Wiring & Contract Audit Engine PRD
- **版本**：v2.0.0 (基於 Fable 六層接線架構與工程實踐全面升級)
- **狀態**：Approved / Ready for Production Deployment
- **最後更新**：2026-09-08
- **核心產物**：	ools/scan-wiring.mjs, docs/audit/wiring-<date>.md, docs/audit/wiring-<date>.json, wiring.allowlist.json

---

## 1. Problem Statement (問題陳述)

在將 Web / HTML 原型（screens/*.html）快速過渡到微信小程序的過程中，團隊面臨「UI 外表已遷移、但互動神經與數據契約實質斷裂」的嚴重缺陷。傳統 Swagger 或 Contract Testing 只能檢驗已登記 API 的連通性，無法發現「需求側已經向用戶保證、但從未被實作或命名的契約缺口」。

具體痛點包括：
1. **元素與事件的虛空綁定**：WXML 標籤引用了不存在的 Page 方法，點擊直接引發運行時無響應或錯誤。
2. **表面化與佔位實現（Stubbing & Hollow Pages）**：大量 handler 僅僅彈出 wx.showToast（如「功能開發中」、「暫未開放」）、或只在本地 setData 假裝成功，整頁依然是字面量原型，未真正觸碰後端 Service。
3. **契約動態漂移與 422 隱患**：Service 呼叫中的請求體（Request Body Keys）傳遞了後端 Schema 未定義的欄位，在 dditionalProperties: false 的強校驗下會直接噴出 422 錯誤。
4. **角色孤兒接口（Orphaned Endpoints）**：後端已宣告面向特定角色（如教師端）的合法端點，但小程序代碼搜遍了都無人認領，存在功能遺漏風險。
5. **原型流轉斷裂**：HTML 原型中存在的關鍵跳轉鏈路或按鈕文案，在小程序頁面中無對應節點或無法跳轉。

---

## 2. Solution (解決方案)

將從小程序前端到後端 API 的完整路徑建模為一條**「元素 (Element) $\rightarrow$ 事件 (Event) $\rightarrow$ 處理器 (Handler) $\rightarrow$ 服務層 (Service) $\rightarrow$ 契約 (Contract)」**的五環鏈條。採用**「六層靜態逐環比對（L1–L6）」**，斷在哪一環就精準報在哪一環，並結合反向角色過濾與業務元數據校驗。

### 六層檢查架構 (The 6-Layer Architecture)
* **L1 (Handler 實體與深度分類)**：驗證 WXML 事件對應的 Page 方法是否存在；沿著調用鏈分析其是佔位（Toast）、純導航、純本地狀態變更、還是觸達 Service。
* **L2 (互動外觀但無事件懸空)**：檢測原生控制項或具備按鈕樣式/文案的節點，排除祖先節點具備事件的合法情況（ncestorHasTap）。
* **L3 (Service $\rightarrow$ 契約深度校驗)**：校驗 Service 內的每次 API 調用：動詞、路徑表達式、ction 業務標識、請求體鍵值與 OpenAPI Schema 的嚴格比對。
* **L4 (角色過濾之反向契約排查)**：以角色（如 x-hualong-roles: teacher）為邊界，逆向找出後端承認、但小程序完全未引用的接口。
* **L5 (原型 HTML 互動與拓撲差集)**：以 screens/*.html 為對照源，比對漏遷移的按鈕文案以及原型具備但小程序未實作的跨頁跳轉（<a> $\rightarrow$ 
avigateTo）。
* **L6 (業務寫入意圖檢驗)**：讀取規格元數據 screens.tsv 中標記為 writes=yes 的頁面，驗證其是否具備可達的 POST/PUT/PATCH/DELETE 寫入調用。

### 三級判定嚴重度 (Severity Levels)
* **確定 (Sure)**：機器可證明的硬缺陷（方法不存在、路徑不在契約、傳入非定義欄位且 dditionalProperties: false、角色 403 違規）。
* **高疑 (Likely)**：有互動外觀無事件、佔位 Handler（「開發中」）、writes=yes 但無任何寫入調用。
* **待審 (Review)**：原型有但小程序無、只改本地狀態但文案具寫入意圖、契約有客戶端未用、動態路徑/鍵值。

---

## 3. User Stories (使用者故事)

### 3.1 前端工程師視角
1. 作為小程序工程師，我希望運行腳本能自動列出所有 WXML 中綁定了但在 JS 內不存在的方法（L1 確定級），以便立即補上方法宣告。
2. 作為小程序工程師，我希望腳本能識別空 catchtap 是為了攔截事件冒泡，並對包裹在 indtap 卡片內的內部按鈕自動放行，避免無效的 L2 假陽性。
3. 作為小程序工程師，我希望知道哪些 Handler 被識別為「改了本地狀態，但帶有‘開發中’字樣」的假操作（L1 高疑級），以便按圖索驥替換為真實 API。
4. 作為小程序工程師，我希望知道我在 Service 中組裝的 Request Body 是否夾帶了無效欄位，特別是後端設有 dditionalProperties: false 的端點（L3 確定級），避免上線後噴 422 錯誤。

### 3.2 架構師與產品負責人視角
5. 作為架構師，我希望在 screens.tsv 登記某頁為 writes=yes 後，審計器能自動揪出那些「表面上接了 service、但實際上全頁只有 GET 查詢、根本沒調寫入接口」的未完工頁面（L6 高疑級）。
6. 作為產品負責人，我希望獲得一份按角色過濾的未調用接口清單（L4），並附帶摘要與 x-hualong-blocked-on 依賴說明，以便快速指派是「該接」、「決議不建」、還是「前置依賴阻塞」。
7. 作為審查者，我希望每次審核填寫的結論（「接 / 不建 / 阻於 Gnn / 誤報」）能被持久化保存，下次重新掃描時自動保留歷史審核紀錄，不會被重複覆蓋。

---

## 4. Implementation Decisions (實施決策)

### 4.1 核心架構與解析引擎（基於 Fable 原型落地）

#### 決策 1：
ode:vm + Proxy 沙箱提取技術
* **問題**：靜態解析小程序的 JS/TS 物件字面量極度繁瑣且易受語法多樣性干擾。
* **決策**：
  - 放棄龐大的 AST Parser，使用 Node.js 原生 
ode:vm 模組在安全沙箱中直接執行 index.js。
  - 將 wx、getApp()、getCurrentPages() 以及非相對路徑的 equire 全量代理為遞迴 Proxy 對象，只精準攔截 Page(options) 與 Component(options) 傳入的配置。
  - 沙箱執行逾時設為 2000ms；若載入異常則自動降級為正則表達式第一層提取保底。

#### 決策 2：祖先事件鏈回溯（ncestorHasTap）
* **問題**：卡片或列表項目常見 <view bindtap="onClick"><text class="btn">詳情</text></view>，若只看子節點會引發大量 L2 誤報。
* **決策**：在 WXML 標籤流解析時維護節點棧（Stack），凡當前節點之祖先鏈中任一節點含有 	ap/longpress、或祖先標籤為 
avigator/orm，一律判定為已具備點擊能力。

#### 決策 3：OpenAPI 業務語義擴充欄位比對（L3/L4）
* **決策**：
  - **角色邊界**：L4 逆向掃描強制過濾 op.roles.includes('teacher')，非當前客戶端權限的接口（如管理員、系統批次任務）直接隱藏。
  - **業務動作標識**：比對 Service 調用中的 ction: ACTIONS.xxx 是否與契約的 x-hualong-action 吻合，防範業務動態防重或冪等校驗失敗。
  - **阻斷標記呈現**：直接在報告中呈現 x-hualong-blocked-on，將技術阻塞原因直接轉化為審核結論的「阻於 Gnn」。

#### 決策 4：表單語意與數據流補強（GAP-W 防護升級）
* **問題**：Fable 原型對 <input> 若無事件直接報 L2，但在 <form bindsubmit> 結構下包含 
ame 屬性的 input、以及使用 model:value 的 input 均為合法語法。
* **決策**：
  - 在 L2 檢查中，若節點為 input 且包含 
ame 屬性且祖先含有 <form>，或節點屬性包含 model:value，直接放行，不計入無事件警告。
  - **新增 GAP-W 規則**：若 Handler 呼叫了 Service 且實質讀取了 	his.data.foo，但頁面對應的 alue="{{foo}}" 節點無任何更新管道（無 indinput、無 indchange、無 model:、非 form submit），在 L1 中標記為「數據流斷裂（GAP-W）」。

#### 決策 5：審核狀態持久化機制（The Sticky Allowlist）
* **問題**：重新執行掃描腳本會覆蓋 Markdown 報告，抹除人工在「結論」欄填寫的審核結果。
* **決策**：
  - 引入 docs/audit/wiring.allowlist.json。
  - 格式定義：
    `json
    {
      "rules": [
        {
          "key": "case-library:L5:原型按钮「小班」",
          "status": "DO-NOT-BUILD",
          "reason": "已重構為動態 categories 列表渲染",
          "author": "Herman",
          "updated_at": "2026-09-08"
        }
      ]
    }
    `
  - 腳本在生成 Markdown 報告時，主動載入該清單，命中者自動填入「結論」欄，若標記為「誤報」則自動移至折疊區域或隱藏。

---

## 5. Report & Data Specifications (報告與數據結構)

### 5.1 生成報告格式 (wiring-<date>.md)

`markdown
# 接線掃描 2026-09-08

契約：D:\hualong-backend\api\openapi.yaml

## 總覽

| 計數項 | 值 |
| --- | --- |
| 頁面 | 55（已接 service 26，未接 29） |
| 確定 | 0 |
| 高疑 | 36 |
| 待審 | 20 |
| 契約教師可調操作 | 92，其中無 service 調用 43 |

等級：**確定** = 機器能證明；**高疑** = 有互動外觀無事件、佔位 handler、writes=yes 無寫入；**待審** = 原型有小程序無、只改本地狀態、契約有客戶端未用。

「結論」列留給審核：寫「接」「不建（DO-NOT-BUILD n）」「阻於 Gnn」「誤報」之一。

## 一、service → 契約（L3）
...

## 二、契約有、客戶端沒調的教師端操作（L4）
| 方法 | 路徑 | 模組 | 動作鍵 | 阻斷於 | 摘要 | 結論 |
| --- | --- | --- | --- | --- | --- | --- |
| POST | /teacher/growth-book/sections | growth-book | book_section.create |  | 新增班級欄目（NONE→d1） |  |

## 三、已接 service 的頁面（這裡的缺口最意外）
...

## 四、未接 service 的頁面（缺口是預期的，這裡是待辦清單）
...
`

---

## 6. Testing Decisions (測試與驗證決策)

1. **沙箱逃逸與超時測試**：
   - 構造包含死循環（while(true)）的惡意 index.js，驗證 m.runInNewContext 能在 2000ms 內安全中斷並退回正則保底，不阻塞掃描流水線。
2. **複雜 WXML 插值標籤測試**：
   - 構造含有多重插值如 <view class="btn {{count > 0 ? 'active' : ''}}" data-url="a>b"> 的節點，驗證標籤流解析器不會因為屬性內的 > 提前截斷或錯位行號。
3. **動態路徑常數替換測試**：
   - 驗證 ${TASK_PATH}//submissions 等模板字串能被正確解析並對照到 OpenAPI 規範中的 /tasks/{task_id}/submissions。

---

## 7. Out of Scope (非本期範圍)

1. **運行時真機渲染還原度比對**：組件 CSS 樣式錯位、文字重疊等渲染層問題不在靜態掃查範圍內。
2. **業務邏輯內部條件覆蓋率**：Handler 內部雖然呼叫了 Service，但因 if-else 邏輯寫錯導致的業務異常，仍依賴業務單元測試與集成測試覆蓋。
3. **非特定角色（非 Teacher）接口**：後台管理端、排程端、Webhook 等接口明確排除在審計主表之外。

---

## 8. Rollout & Audit Cadence (落地與推進節奏)

* **Phase 1（立即執行，清理存量）**：
  1. 運行 
ode tools/scan-wiring.mjs，產出全量 wiring-<date>.md。
  2. 優先攻克 **Section 3（已接 Service 的頁面）** 裡的高疑項（如 upload-resource 的佔位 Handler）。
  3. 召開前後端架構對質會，針對 **Section 2（L4 契約未用接口）** 逐條標記結論（「接 / 不建 / 阻於」），並將結論寫入 wiring.allowlist.json。
* **Phase 2（CI 門禁防禦）**：
  1. 將腳本接入 Git pre-commit 或 GitHub Actions。
  2. 門禁規則：若 PR 新增代碼中出現「**確定**」級缺陷（如新增呼叫但契約不存在、或傳入無效 body key 導致 422），直接阻斷合入。