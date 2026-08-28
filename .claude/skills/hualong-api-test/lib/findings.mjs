/**
 * The finding model, and the two ways a run ends: a report and an exit code.
 *
 * Severity is not a mood. `high` means something is exposed or something is
 * being lost right now, and only `high` turns the exit code red. Everything
 * else is written down and read by a human. An exit code that stays red for
 * weeks stops being looked at, which is worse than not having one.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..', '..');

/** The only four classes that fail a run. Anything else is `medium` or lower. */
export const HIGH = new Set(['exposure', 'data-loss', 'hardening-off', 'undeclared-path']);

export class Run {
  constructor() {
    this.findings = [];
    this.skipped = [];
    this.started = new Date();
  }

  /** @param {{layer:string, severity:'high'|'medium'|'low', kind:string, what:string, detail?:any}} f */
  add(f) {
    if (f.severity === 'high' && !HIGH.has(f.kind)) {
      throw new Error(`high severity needs a declared kind, got "${f.kind}"`);
    }
    this.findings.push(f);
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

  report() {
    const order = { high: 0, medium: 1, low: 2 };
    const ranked = [...this.findings].sort((a, b) => order[a.severity] - order[b.severity]);

    for (const f of ranked) {
      const tag = { high: '!!', medium: ' !', low: '  ' }[f.severity];
      console.log(`${tag} [${f.layer}/${f.kind}] ${f.what}`);
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

    const high = ranked.filter((f) => f.severity === 'high').length;
    console.log('');
    console.log(`${ranked.length} finding(s): ${high} high, ` +
      `${ranked.filter((f) => f.severity === 'medium').length} medium, ` +
      `${ranked.filter((f) => f.severity === 'low').length} low. ` +
      `${this.skipped.length} layer(s) skipped.`);

    const stamp = this.started.toISOString().replace(/[:.]/g, '-');
    const dir = join(REPO, 'tools', '.report', 'api-test');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${stamp}.json`);
    writeFileSync(path, JSON.stringify({
      started: this.started.toISOString(),
      findings: ranked,
      skipped: this.skipped,
    }, null, 2));
    console.log(`report  ${path}`);
    return this.failed ? 1 : 0;
  }
}
