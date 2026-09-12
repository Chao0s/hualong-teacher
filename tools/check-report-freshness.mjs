/**
 * 接线报告够不够新 —— 一份实现，两个调用方。
 *
 *   node tools/check-report-freshness.mjs            人看：印一行结论，永远退出 0
 *   node tools/check-report-freshness.mjs --strict   闸门：旧了就退出 1
 *
 * 为什么需要它：`scan:wiring --emit` 写两张表，**不写审计报告**（`scan-wiring.mjs`
 * 头注第 8–10 行写明那是两条路）。而 `launch api-doc.bat` 只跑 `--emit`，
 * `/pages` 的 service 层那一列却取最新一份 `wiring-*.json`。于是页面上的表是新算的、
 * 那一列是旧的 —— 看起来一样新。2026-09-12 实测差 0.93 小时。
 *
 * 判据：报告比**它扫过的任何输入**都新。输入 = `miniprogram/pages/**` 与
 * `miniprogram/services/**`。报告本身不算输入。
 *
 * 只有一份实现，是因为第二份一定会漂 —— 本仓已有过 `bodyOf()` 与 `readTsv()`
 * 两个「第二份不该存在」的实例。
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT = join(REPO, 'docs', 'audit');
const STRICT = process.argv.includes('--strict');

const newestUnder = (dir, accept) => {
  let best = { f: '', t: 0 };
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!accept(e.name)) continue;
      const t = statSync(p).mtimeMs;
      if (t > best.t) best = { f: p.slice(REPO.length + 1).replace(/\\/g, '/'), t };
    }
  };
  walk(dir);
  return best;
};

const reports = existsSync(AUDIT)
  ? readdirSync(AUDIT)
    .filter((f) => /^wiring-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => ({ f, t: statSync(join(AUDIT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  : [];

const scanned = [
  newestUnder(join(REPO, 'miniprogram', 'pages'), (n) => /\.(js|wxml)$/.test(n)),
  newestUnder(join(REPO, 'miniprogram', 'services'), (n) => n.endsWith('.js')),
].sort((a, b) => b.t - a.t)[0];

const mins = (ms) => Math.round(ms / 60000);

if (!reports.length) {
  console.log('[接线报告] 一份都没有。`/pages` 的 service 层那一列会直说没读到，这一列不猜。');
  console.log('           生成：npm run scan:wiring');
  process.exit(STRICT ? 1 : 0);
}

const age = scanned.t - reports[0].t;
if (!scanned.f || age <= 0) {
  console.log(`[接线报告] 够新：${reports[0].f} 不旧于任何已扫文件。`);
  process.exit(0);
}

console.log(`[接线报告] 旧了 —— 这是「表格新、那一列旧」的缺口。`);
console.log(`           报告   ${reports[0].f}   ${new Date(reports[0].t).toISOString()}`);
console.log(`           输入   ${scanned.f}   ${new Date(scanned.t).toISOString()}`);
console.log(`           旧 ${mins(age)} 分钟。`);
console.log('           /pages 的 service 层那一列取的就是这份报告，它比页面旧。');
console.log('           修：npm run scan:wiring   （会写一份新的 docs/audit/wiring-<日期>.json）');
process.exit(STRICT ? 1 : 0);
