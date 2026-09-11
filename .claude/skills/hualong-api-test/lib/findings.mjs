/**
 * The finding model, and the two ways a run ends: a report and an exit code.
 *
 * Severity is not a mood. `high` means something is exposed or something is
 * being lost, and only `high` turns the exit code red. Everything else is
 * written down and read by a human. An exit code that stays red for weeks stops
 * being looked at, which is worse than not having one.
 *
 * ── 穩定主體（2026-09-12 加）──────────────────────────────────────────────
 *
 * 人可以對一條發現下結論（`docs/audit/checker-feedback.tsv`），而那要有一個
 * **每次跑都一樣的名字**。所以每條發現可以帶 `subject`，key 就是
 * `layer:kind:subject`。
 *
 * **不能從 `what` 那句抽。** 那句裡有數字（「42 operation(s)…」），
 * 而那個數字每次跑都不一樣 —— 用它當鍵，等於每跑一次就把人的結論丟掉一次。
 *
 * **沒有 `subject` 的發現不可審**，而且這件事要被數出來（報告會印
 * 「M 條發現裡 N 條帶穩定鍵」）。一條不可審的發現不能靜默地看起來跟可審的一樣。
 *
 * **同一條 key 出現兩次＝一個 bug**：一個結論會同時蓋住兩條發現。
 * `add()` 當場拋，不讓它進報告。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..', '..');

/** The classes that fail a run. Anything else is `medium` or lower. */
export const HIGH = new Set(['exposure', 'data-loss', 'hardening-off', 'undeclared-path', 'stale-expectation']);

/**
 * 組一條發現的穩定 key。
 * `subject` 要短、要穩定、要能指到一個東西（一個操作、一屏、一個欄、一個資源）。
 * 不要放數字、不要放句子。
 */
export const keyOf = (layer, kind, subject) => `${layer}:${kind}:${subject}`;

export class Run {
  constructor() {
    this.findings = [];
    this.skipped = [];
    this.started = new Date();
    this._keys = new Map();
  }

  /** @param {{layer:string, severity:'high'|'medium'|'low', kind:string, what:string, subject?:string, detail?:any}} f */
  add(f) {
    if (f.severity === 'high' && !HIGH.has(f.kind)) {
      throw new Error(`high severity needs a declared kind, got "${f.kind}"`);
    }
    const subject = (f.subject ?? '').trim();
    const key = subject ? keyOf(f.layer, f.kind, subject) : '';
    if (key) {
      const seen = this._keys.get(key);
      if (seen !== undefined) {
        // 一個結論會同時蓋住兩條發現 —— 那是 bug，不進報告。
        throw new Error(
          `duplicate finding key "${key}" (findings #${seen} and #${this.findings.length}).\n` +
          `一条结论会同时盖住两条发现。给其中一条更具体的主体。`,
        );
      }
      this._keys.set(key, this.findings.length);
    }
    this.findings.push({ ...f, key, reviewable: Boolean(key) });
  }

  /**
   * A layer that could not run. Never silent: an unrunnable check leaves a
   * question open, and the report has to say which question.
   */
  skip(layer, why, unknown) {
    this.skipped.push({ layer, why, unknown });
  }

  get failed() {
    return this.findings.some((f) => f.severity === 'high');
  }

  /** 可審 / 不可審的數目。報告與閘門都用它。 */
  get reviewability() {
    const total = this.findings.length;
    const reviewable = this.findings.filter((f) => f.reviewable).length;
    return { total, reviewable, unkeyed: total - reviewable };
  }

  report() {
    const order = { high: 0, medium: 1, low: 2 };
    const ranked = [...this.findings].sort((a, b) => order[a.severity] - order[b.severity]);

    for (const f of ranked) {
      const tag = { high: '!!', medium: ' !', low: '  ' }[f.severity];
      console.log(`${tag} [${f.layer}/${f.kind}] ${f.what}`);
      if (f.key) console.log(`       key  ${f.key}`);
      if (f.detail !== undefined) {
        const lines = String(typeof f.detail === 'string' ? f.detail : JSON.stringify(f.detail, null, 1)).split('\n');
        for (const l of lines.slice(0, 8)) console.log(`      ${l}`);
        if (lines.length > 8) console.log(`      … ${lines.length - 8} more lines, see the report`);
      }
    }

    for (const s of this.skipped) {
      console.log(`   [${s.layer}] SKIPPED — ${s.why}`);
      console.log(`      leaves unknown: ${s.unknown}`);
    }

    const rv = this.reviewability;
    const high = ranked.filter((f) => f.severity === 'high').length;
    console.log('');
    console.log(`${ranked.length} finding(s): ${high} high, ` +
      `${ranked.filter((f) => f.severity === 'medium').length} medium, ` +
      `${ranked.filter((f) => f.severity === 'low').length} low. ` +
      `${this.skipped.length} layer(s) skipped.`);
    // 「帶穩定鍵」要印出來：不可審的發現不能看起來跟可審的一樣。
    console.log(`reviewable: ${rv.reviewable} of ${rv.total} carry a stable key` +
      (rv.unkeyed ? ` — ${rv.unkeyed} cannot take a verdict (no subject)` : ''));

    const stamp = this.started.toISOString().replace(/[:.]/g, '-');
    const dir = join(REPO, 'tools', '.report', 'api-test');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${stamp}.json`);
    writeFileSync(path, JSON.stringify({
      started: this.started.toISOString(),
      reviewability: rv,
      findings: ranked,
      skipped: this.skipped,
    }, null, 2));
    console.log(`report  ${path}`);
    return this.failed ? 1 : 0;
  }
}
