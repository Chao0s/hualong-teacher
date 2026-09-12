/**
 * 「原型意圖 ↔ 客戶端操作」對稱表 —— **全倉唯一一份 join**。
 *
 * 這條 join 從前只活在 `.claude/skills/hualong-api-test/scripts/symmetric-table.mjs` 裡，
 * 而且只印終端機（那一支的頭注自己寫著「這不是最終對稱表」）。
 * 算它的部分現在抽到這裡，兩個呼叫方共用同一份：
 *
 *   .claude/skills/hualong-api-test/scripts/symmetric-table.mjs   終端機樣本（人看的）
 *   tools/swagger/pages-view.mjs                                  /pages 每屏卡裡的「意圖行」
 *
 * 兩邊的數字來自同一次計算 —— 對稱表不會有第二份，因此不會漂。
 *
 * ## 四段來源，各有各的歸屬，不要互相頂替
 *
 *   意圖     `screens/<屏>.html` 的 `data-intent`（原型上肉眼可點的東西）
 *   操作     `hualong-backend/db/spec/screen-operations.tsv`（一屏一操作一行）
 *   主表     `hualong-backend/db/spec/screens.tsv` 的 `primary_tables`
 *   （契約外）**問 `openapi.yaml` 的 operationId** —— 不是問 `action-registry.tsv`。
 *            `action-registry` 只登記**寫**，拿它判會把每一條**讀**誤標成契約外
 *            （2026-09-12 撞過：`listBookSections` 明明在 `openapi.yaml` 裡）。
 *
 * ## 配對規則：位置配對，不是聰明配對
 *
 * 意圖第 i 個對操作第 i 條，某一邊沒有的就留空。
 * 這一版**刻意不猜**：兩邊的 id 不同源（`home.banner-img` vs `listMyTasks`），
 * 硬配會造出一批看起來對、其實錯的對子 —— 那比留空更壞，因為留空看得出來、
 * 錯的對子看不出來。人對著這一列判「這條意圖該配哪條操作」正是要判的東西。
 *
 * 螢幕名到原型的對照走 `screens/([^/]+)/` 那一格（與 `screen-ops-data.mjs` 同一條），
 * 實測 `screen_file` 的檔名與屏名 85 行全同、0 不同，所以直接拼 `screens/<屏>.html` 也對。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTsv, BACKEND_DIR } from './screen-ops-data.mjs';

/** 倉根由模組位置推 —— 與 `screen-ops-data.mjs` 同一條，不看 process.cwd()。 */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 後端倉在哪：**唯一一份**決定在 `screen-ops-data.mjs` 的 `backendRoot()`，從那裡取。 */
const BACKEND = BACKEND_DIR;
const SPEC = join(BACKEND, 'db', 'spec');

/** 讀一次就留著：同一支程式裡三次 join 不重讀三遍檔。 */
const cache = new Map();
const once = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

/** `screen-operations.tsv` 全部行（一屏一操作一行）。 */
export const screenOpRows = () => once('ops', () => readTsv(join(SPEC, 'screen-operations.tsv')));

/** 屏 → 主表（讀用的那一格，寫的歸屬看 `action-registry`，這一支不管寫）。 */
export const primaryTables = () => once('tables', () => {
  const out = new Map();
  for (const s of readTsv(join(SPEC, 'screens.tsv'))) {
    const m = (s.mp_file ?? '').match(/pages\/([^/]+)\//);
    if (m && !out.has(m[1])) out.set(m[1], s.primary_tables ?? '');
  }
  return out;
});

/** 契約宣告的 operationId 集合。判「契約外」只能問它。 */
export const declaredOperationIds = () => once('declared', () => {
  const yaml = readFileSync(join(BACKEND, 'api', 'openapi.yaml'), 'utf8');
  return new Set([...yaml.matchAll(/operationId:\s*(\w+)/g)].map((m) => m[1]));
});

/**
 * 一屏的意圖 —— 從原型的 `data-intent` 讀，同一 id 出現幾次算幾次。
 * 讀不到原型就回空陣列：**不是**「這一屏沒有意圖」，呼叫方要把空講出來。
 *
 * 同時把**那個元素自己的字**抽出來（`text`）。這不是猜：標記掛在真實元素上，
 * 元素上有原型的可見中文。沒有它，畫面只印 `assessment-tool.sum-lvl` 這種 id ——
 * 看不懂的人（朝湃）對不上那是螢幕上的哪一塊，也就無從判「這條意圖配得對不對」。
 *
 * 取字的規矩：**先取這個元素自己的那一段**（到第一個子元素為止）。
 * 沒有自己的字（字在子元素裡，例如 `topfix` 那條置頂欄）時，退回**子孫裡的第一段字**，
 * 因為人站在螢幕前看到的就是那一塊的字。兩者都取不到才留空 —— 不填 `?`：
 * 空看得出來，假的分類看不出來。
 * 2026-09-12 補：自己的那一段**不合格**（只有一個 `›`／`×`／`+` 這樣的符號）時也走同一條
 * 退路，而不是直接留空 —— 那一格明明下面有字。兩個候選的判據見下面的 `asText`。
 */
export function intentsOf(protoFile) {
  const file = join(REPO, protoFile);
  if (!existsSync(file)) return [];
  const html = readFileSync(file, 'utf8');
  const clean = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const m = new Map();
  const re = /<([a-z0-9]+)([^>]*\bdata-intent="([^"]+)"[^>]*)>/gi;
  let x;
  while ((x = re.exec(html))) {
    const [, tag, , id] = x;
    if (!m.has(id)) m.set(id, { id, n: 0, text: '', tag });
    m.get(id).n += 1;
    const cur = m.get(id);
    if (cur.text) continue;
    const rest = html.slice(x.index + x[0].length);
    // 自己的字：到下一個開標籤或結尾標籤為止。
    const own = clean(rest.split(/<\/?[a-z0-9]/i)[0] ?? '');
    // 字在子元素裡時（`topfix` 那條置頂欄就是），把這一段的標籤全剝掉，
    // 取**第一段連續 ≥2 個非標點字**。
    //
    // 前兩版都在這裡吃過虧：只取第一個子元素的字，`topfix` 拿到一個破折號、`todo-cards`
    // 拿到圖示那一個字 —— 那不是這一塊的名字。取「第一段有意義的字」才對得上人站在
    // 螢幕前看到的第一眼。**界線是 300 字**：再往後就可能跨進手足元素，那是別人的字。
    const stripped = clean(rest.slice(0, 300).replace(/<[^>]*>/g, ' '));
    const mm = stripped.match(/[^\s—–\-·、。，,./|:：（）()\[\]{}"'’“”]{2,}/);
    const deep = mm ? mm[0] : '';

    // 一個候選算不算「字」：含 `<`／`>` 的一律丟 —— 那是一個沒被剝乾淨的標籤，不是
    // 這一塊的字（`topfix` 撞過）。**單一個漢字也算**：原型上「住」「传」「衣」就是一個字，
    // 那是螢幕上肉眼可見的標籤，不是圖示；只有一個符號（`›`、`→`、`×`、`+`）才不算。
    const asText = (s) => {
      const cand = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!cand || /[<>]/.test(cand)) return '';
      const bare = cand.replace(/[\s—–\-·、。，,.…/|:：]+/g, '');
      return (/^[\u4e00-\u9fff]$/.test(bare) || bare.length >= 2) ? cand : '';
    };

    // 第三版（2026-09-12）：判據從「自己的字優先，不合格就留空」改成**逐個候選試** ——
    // 上一版之下，只有一個 `›`／`×`／`+` 的元素明明下面有字，那一格卻是空的
    // （581 行裡 73 行，用戶第一眼看的就是這些空格）。
    // 退回第一段時多一條：**這一段必須含漢字**。那一段常常落在原型的 `<script>` 裡，
    // 不留這條就會把 `head`、`domain`、`${item.note}` 當成螢幕上的字填進去 —— 假的比空的壞。
    // 自己的字本來就是空的（`topfix` 那類）不算「退回」：那是元素自己沒有字，與上一版同一種走法。
    cur.text = asText(own) || (own ? (/[\u4e00-\u9fff]/.test(deep) ? asText(deep) : '') : asText(deep));
  }
  return [...m.values()];
}

/**
 * 一屏的對稱表。
 *
 * @param {string} screen  屏名（`miniprogram/pages/<屏>/`）
 * @param {{protoFile?: string}} [o] 原型檔名，默認 `screens/<屏>.html`
 * @returns {{screen, protoFile, tables, intents, ops, pairs, matched, unpaired, pureRead, hasPrototype}}
 */
export function joinScreen(screen, { protoFile = `screens/${screen}.html` } = {}) {
  const intents = intentsOf(protoFile);
  const ops = screenOpRows().filter((o) => o.screen === screen);
  const declared = declaredOperationIds();

  // 位置配對：第 i 個意圖 ↔ 第 i 條操作。長的一邊多的那些，另一邊留空。
  const pairs = [];
  for (let i = 0; i < Math.max(intents.length, ops.length); i++) {
    const op = ops[i];
    pairs.push({
      intent: intents[i] ?? null,
      op: op ?? null,
      // 契約外要在畫面上說出來，且在**這一格**說 —— 表格那一欄只寫 operationId。
      offContract: Boolean(op?.operation_id) && !declared.has(op.operation_id),
    });
  }

  return {
    screen,
    protoFile,
    hasPrototype: existsSync(join(REPO, protoFile)),
    tables: primaryTables().get(screen) ?? '',
    intents,
    ops,
    pairs,
    // 三個數與終端機那張樣本表逐字對應（`symmetric-table.mjs` 的末行）。
    matched: ops.filter((o) => (o.trigger_prototype ?? '').trim()).length,
    unpaired: ops.filter((o) => /原型有意圖未對上/.test(o.trigger_flag ?? '')).length,
    pureRead: ops.filter((o) => !(o.trigger_wxml ?? '').trim()).length,
  };
}

/** 全部屏的對稱表 + 合計。`/pages` 用這一個，屏的順序由呼叫方決定。 */
export function joinAll(screens) {
  const joins = new Map();
  for (const s of screens) joins.set(s, joinScreen(s));
  const totalIntents = [...joins.values()].reduce((n, j) => n + j.intents.length, 0);
  const totalOps = [...joins.values()].reduce((n, j) => n + j.ops.length, 0);
  return { joins, totalIntents, totalOps };
}
