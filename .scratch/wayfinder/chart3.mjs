// 把「原型加机读意图标记」这一决定写进 wayfinder，并出一份候选清单。
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = 'Chao0s/hualong-teacher';
const DIR = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher/.scratch/wayfinder';
const sh = (c) => execSync(c, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

const body = `## Question

**這是整張圖的閘門票。** 使用者 2026-09-12 裁定：**給原型加機讀意圖標記，一個意圖一個穩定 id。**

### 為什麼它是閘門

本圖要的是一張**逐意圖的對稱表**：原型的每個意圖 ↔ wxml 的元素 ↔ 操作 ↔ 資料表 ↔ 桶。
今天這張表**不存在**（\`/pages\` 的每張表只有 7 列：狀態・方法・路徑・操作・說人話・觸發・缺口，
**沒有原型列、沒有表列、沒有桶列**）。而它不存在的原因是：**意圖的權威沒有機讀形式。**

實測（2026-09-12，56 份原型）：

| 標記 | 數量 |
|---|---|
| \`<button>\` | **158** |
| \`class\` 含 \`btn\` | **76** |
| \`onclick=\` | **只有 3** |
| 含 \`data-ui\` 的原型 | **22 份**（且只標表單欄位） |

**\`home.html\` 是 0 個 \`<button>\`、0 個 \`class~btn\`。** 它的意圖寫在
\`class="quick-item"\`／\`todo-card\`／\`resource-card\`／\`<a href>\` 上 —— **靠類名表達的可點區塊**。

而讀取器 \`prototypeInteractions()\` 只認一種標記：

\`\`\`js
const buttons = [...html.matchAll(/<button\\b([^>]*)>([^<]*)/g)]
\`\`\`

**所以 \`trigger_prototype\` 只有 29／142 行有值，不是原型沉默，是讀取器看不見。**
那 20 條「原型無按鈕」與 71 條「無觸發詞」裡**混著讀取器的盲區** ——
**看不見與不存在是兩件事**，這正是本票要消掉的那個不確定。

### 要做的

1. **先出候選清單給你審**（不盲改 56 份）：一個腳本掃出每個原型的每個可點區塊，
   列出 檔案・標籤・類名・文案・建議的 intent id，按檔案分組計數。
2. 你審過之後，把 \`data-intent="<screen>.<區塊>.<動作>"\` 標上去。
3. 改讀取器：\`prototypeInteractions()\` 以 \`data-intent\` 為準（類名启发式退為兜底）。
4. 重跑 \`emit:screens\`，\`trigger_prototype\` 應從 29 行升到覆蓋全部意圖。

### 兩條規矩

- **不要把第二份詞表寫進讀取器。** \`scan-wiring.mjs\` 的 \`buttonish()\` 三張表已按實測校準過
  （2026-09-09，#8：244 個帶 tap 的節點認出 202 個）。新讀取器**先看能不能復用它**；
  要為原型另立一張，就把理由寫在票裡。
- **改原型是改「意圖的權威」**。動它之前要分清：這一格是**意圖**（原型的職責），
  還是**落後的實現**（那就該改的是實現）。判據見 CLAUDE.md §1 與 \`decision.md\`。

### 做完要回填的

候選清單（給你審的檔案路徑）· 標記後的 \`data-intent\` 總數 · \`trigger_prototype\` 的非空行數
（應遠高於 29）· 以及 \`proto\` 層在那之後的計數。`;

writeFileSync(`${DIR}/t86.md`, body);
const url = sh(`gh issue create -R ${REPO} --label "wayfinder:grilling" --title ${JSON.stringify('意圖閘門 · 給原型加機讀意圖標記（\u4e00\u500b\u610f\u5716\u4e00\u500bid\uff09')} --body-file "${DIR}/t86.md"`);
const num = url.split('/').pop();
console.log(`✓ #${num}  意圖閘門票`);

// 把新票加进地图的子票清单
const oldBody = sh(`gh issue view 76 -R ${REPO} --json body --jq .body`);
const list = oldBody.match(/^- \[.*$/gm) ?? [];
const newBody = oldBody.replace(list.join('\n'), `${list.join('\n')}\n- [意圖閘門 · 給原型加機讀意圖標記（一個意圖一個 id）](${url})`);
writeFileSync(`${DIR}/map76b.md`, newBody);
sh(`gh issue edit 76 -R ${REPO} --body-file "${DIR}/map76b.md"`);
console.log(`✓ 地图 #76 子票 ${list.length + 1} 条`);
