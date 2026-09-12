/**
 * 發現（finding）的**中文對照** —— 一個 kind 一句，人看的那一面。
 *
 *   tools/lib/finding-eli10.tsv      kind → 一句中文（17 行，一個 kind 一行）
 *
 * 為什麼是「一個 kind 一句」而不是「一條發現一句」：報告裡同一種 kind 會出現很多條
 * （實測 `coverage` 20 條）。逐條手寫中文＝多寫一份會過期的副本；而 kind 只有 17 個，
 * 寫一次就覆蓋全部。**渲染時查表**，與 `operation-eli10.tsv` 同一條路。
 *
 * 英文原文（`what`／`detail`／`kind`／`subject`）一律**照留不改**：那是機器產生的，
 * 以後要 grep（例如 `stale-expectation` 這個詞本身就是要搜的目標）。
 * 中文只是**旁邊那一句**，不是取代它。
 *
 * 查不到中文的 kind **不靜默**：`kindZh()` 回空字串，呼叫方要把「这一种还没有中文」畫出來。
 * 缺一句中文與「這條沒有問題」在畫面上长得一样，是最壞的一種錯。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FINDING_ELI10_PATH = join(HERE, 'finding-eli10.tsv');

/** 讀 tsv。**檔不在就拋**，不回空表 —— 空表與壞表長得一樣（本倉已撞過多次）。 */
function readEli10(path) {
  if (!existsSync(path)) throw new Error(`读不到 ${path}（空表与坏表长得一样，所以这里不静默）`);
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const head = lines[0].split('\t');
  if (head[0] !== 'kind' || head[1] !== '中文') {
    throw new Error(`${path} 表头应为 kind<TAB>中文，实际是 ${head.join('|')}`);
  }
  const out = new Map();
  lines.slice(1).filter(Boolean).forEach((l, i) => {
    const [kind, zh] = l.split('\t');
    if (!kind || !zh) throw new Error(`${path} 第 ${i + 2} 行缺 kind 或中文`);
    if (out.has(kind)) throw new Error(`${path} 第 ${i + 2} 行的 kind「${kind}」重复了`);
    out.set(kind, zh);
  });
  return out;
}

/** kind → 一句中文。唯一一份在這份 tsv 裡。 */
export const KIND_ZH = readEli10(FINDING_ELI10_PATH);

/** 查一條中文。查不到回空字串 —— 呼叫方要把它畫出來，不要靜默留白。 */
export const kindZh = (kind) => KIND_ZH.get(kind) ?? '';

/**
 * 檢測層（layer）的中文說法。層名是機器詞，留著；旁邊這一句是給人看的。
 * 十層的名字與職責來自 `.claude/skills/hualong-api-test/run.mjs` 的 LAYERS。
 */
export const LAYER_ZH = {
  cover: '屏幕登记（每屏一行、两个定位符都还在吗）',
  contract: '契约（契约与 mock、登记表对得上吗）',
  wire: '接线扫描（元素→事件→service→契约哪一环断了）',
  proto: '原型（原型与客户端谁落后）',
  repo: '仓库闸门（npm test 与生成物）',
  db: '数据库（本机 PostgreSQL）',
  cos: '对象存储桶（腾讯云 COS）',
  vm: '云主机',
  api: '实跑接口（真打一次线上）',
  render: '开发者工具渲染',
};

/** 严重度：报告里是 high／medium／low，画面上要出中文。 */
export const SEV_ZH = { high: '高', medium: '中', low: '低' };
