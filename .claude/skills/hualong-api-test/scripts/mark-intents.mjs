/**
 * 給原型的可點區塊加 `data-intent` —— 一個意圖一個穩定 id。
 *
 *   node .claude/skills/hualong-api-test/scripts/mark-intents.mjs            # dry-run
 *   node .claude/skills/hualong-api-test/scripts/mark-intents.mjs --apply    # 真寫
 *
 * 為什麼需要它：原型是**意圖的權威**，而在 2026-09-12 之前它沒有機讀形式。
 * 56 份原型裡只有 **158 個 `<button>`、3 個 `onclick`**，而 `home.html` 連一個
 * `<button>` 都沒有 —— 它的意圖寫在 `class="quick-item"` 這種類名上。
 * 舊讀取器只認 `<button>`，於是 `trigger_prototype` 只有 29／142 行有值，
 * 而那不是原型沉默，是**讀取器看不見**。看不見與不存在是兩件事。
 *
 * id 形態：`<screen>.<類名>` —— 由**類名**長出來，不另起一套名字，
 * 這樣原型與讀取器共用一個詞表；改類名時 id 跟著動（那就該動，因為指的東西變了）。
 *
 * 冪等：同一個 id 只標**最外層那一次**，已標的不重標。跑幾次結果都一樣。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');   // scripts → skill → skills → .claude → 倉根
const DIR = join(REPO, 'screens');
const APPLY = process.argv.includes('--apply');

/** 佈局詞：指的是**位置/容器**，不是一個東西。 */
const LAYOUT = /^(row|col|cols|grid|wrap|group|list|container|box|bar|head|header|foot|footer|sec|section|body|panel|area|main|aside|inner|outer|content|sheet|mask|overlay|modal|dialog|scroll|view|page|layout|flow|stack|flex|table|thead|tbody|tr|td|th|line|divider|gap|spacer|tabs|nav|navbar|tabbar|toolbar|top|bottom|left|right|center|mid|half|full)$/i;

/**
 * **明確的「非意圖」名單 —— 不是啟發式。**
 *
 * 判據只有一句：**這個東西會不會有 API？** 不會的就不標。
 * 這 7 個是 2026-09-12 量出來的（709 個標記裡佔 126 個，18%），
 * 它們**全部是啟發式匹配器的錯誤產物** —— 那些東西永遠不會有 API。
 *
 * 要加一條，先答那個判據。要**減**一條，先想清楚它為什麼該有 API。
 */
const NOT_INTENT = new Set([
  'phone',          // 原型畫的手機外框 —— 不是屏幕內容
  'back',           // 返回鍵 —— 小程序由導航欄提供，掃描器早就刻意排除過
  'toast',          // 提示條 —— 反饋，不是操作
  'empty',          // 空狀態佔位
  'empty-hint',     // 空狀態說明
  'time',           // 狀態列時鐘 9:41
  'status-icons',   // 狀態列訊號／電量
]);

/** 部件詞：嵌套在控件裡、但本身指一個東西（會被標，但對稱表只把控件當主角）。 */
const PART = /(icon|name|title|label|text|value|badge|count|num|thumb|avatar|photo|image|img|desc|note|hint|tip|meta|state|status|time|date|price|score|tag|chip|dot|mark|glyph|arrow|caret|cover|summary|sub|prefix|suffix|unit|placeholder)/i;
/** 控件詞：它本身就是可以操作的東西。 */
const CONTROL = /(btn|button|link|item|card|entry|action|toggle|switch|submit|publish|upload|filter|tab|select|picker|open|close|add|more|all|edit|del|remove|save|send|share|fav|like|play|scan|refresh|retry|next|prev|start|stop|confirm|cancel|check)/i;

const attr = (a, n) => (a.match(new RegExp(`${n}\\s*=\\s*"([^"]*)"`, 'i')) ?? [, ''])[1];
const kindOf = (cls) => {
  const segs = cls.split(/\s+/)[0].split(/__|--|[-_]/).filter(Boolean);
  if (segs.some((s) => LAYOUT.test(s))) return 'layout';
  if (segs.some((s) => CONTROL.test(s))) return 'control';
  if (segs.some((s) => PART.test(s))) return 'part';
  return 'other';
};

// `component-showcase.html` **不是一屏**：`app.json` 沒有註冊它，`miniprogram/pages/` 也沒有
// 對應目錄。它是元件展示頁，標它的意圖會讓對稱表多出 48 行不屬於任何屏幕的東西。
const NOT_A_SCREEN = new Set(['component-showcase.html']);

const plan = [];
let touched = 0;

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.html')).sort()) {
  if (NOT_A_SCREEN.has(f)) continue;
  const src = readFileSync(join(DIR, f), 'utf8');
  const screen = f.replace(/\.html$/, '');
  const insertions = [];
  const seen = new Map();

  for (const m of src.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const cls = attr(m[2], 'class');
    if (!cls) continue;
    if (kindOf(cls) === 'layout') continue;

    const primary = cls.split(/\s+/)[0];
    if (NOT_INTENT.has(primary)) continue;

    // **計數要在「已標過」的判斷之前。**
    // 2026-09-12 的錯：先 `if (已有 data-intent) continue` 再計數，於是重跑時
    // 第一個（已標的）沒被算進去，第二個同類元素就變成「第一個」而被標上 ——
    // 每跑一次多加一批（dry-run 顯示 259 個／48 份），原型會被越標越花。
    const id = `${screen}.${primary}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n > 1) continue;

    if (/data-intent\s*=/i.test(m[2])) continue;   // 已經標好了

    const whole = m[0];
    if (!whole.endsWith('>') || whole.endsWith('/>')) continue;
    insertions.push({ at: m.index + whole.length - 1, text: ` data-intent="${id}"`, kind });
  }

  // 收齊插入點，**再從後往前插**。
  // 2026-09-12 的錯：邊掃邊插，而 `m.index` 是**原文**的偏移 —— 插入第一個之後
  // 後面所有偏移都錯了，HTML 被撕成 `<div <span ... data-intent="home<span ...`。
  let out = src;
  for (const ins of [...insertions].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, ins.at) + ins.text + out.slice(ins.at);
  }

  if (insertions.length) {
    touched++;
    plan.push({ file: f, n: insertions.length, byKind: insertions.reduce((a, e) => { a[e.kind] = (a[e.kind] ?? 0) + 1; return a; }, {}) });
    if (APPLY) writeFileSync(join(DIR, f), out, 'utf8');
  }
}

const sum = (k) => plan.reduce((a, p) => a + (p.byKind[k] ?? 0), 0);
console.log(`${APPLY ? '已寫' : 'DRY-RUN（未寫任何檔）'}`);
console.log(`  ${touched} 份原型，共 ${plan.reduce((a, p) => a + p.n, 0)} 個 data-intent`);
console.log(`    control ${sum('control')}  ← 對稱表的主角`);
console.log(`    part    ${sum('part')}  ← 掛在父控件下當輔證`);
console.log(`    other   ${sum('other')}  ← 看不出來的，要人判`);
console.log('\n  跑幾次結果都一樣（冪等）；不會有 API 的東西不標。');
if (!APPLY && plan.length) console.log('  真寫：加 --apply');
