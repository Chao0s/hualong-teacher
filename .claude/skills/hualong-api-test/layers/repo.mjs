/**
 * The repository's own gates: the front-end suite and the backend harness.
 *
 * Neither of these is about the cloud. They answer "is the code still
 * internally consistent", which is the question every other layer assumes the
 * answer to. `npm test` covers the four-file page shape, jump targets, orphan
 * styles, the single-scale rule and the login page's behaviour;
 * `check-all.mjs` covers schema, enums, layout, computed columns and the two
 * screen tables.
 *
 * Both are CALLED, never re-implemented. This repo has already been bitten
 * twice by a second implementation drifting from the first — a `bodyOf()` that
 * could not read a destructured parameter list, and a `readTsv()` that
 * returned an empty array for a missing file instead of failing. A checker that
 * re-implements the thing it checks is a second copy of it.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { REPO } from '../lib/findings.mjs';

const run = promisify(execFile);
const BACKEND = resolve(REPO, '..', 'hualong-backend');

/**
 * `shell: true` is needed for `npm` on Windows (it is `npm.cmd`), and MUST NOT
 * be used for `node` with an absolute script path: this repository lives under
 * a path containing a space ("My Drive"), the shell splits it, node cannot find
 * the file, and the layer reports a red that does not exist.
 *
 * That false red happened on 2026-09-12 — the backend harness was 10/10 PASS
 * when run by hand. Verify the instrument before the finding.
 */
const invoke = async (cmd, args, cwd, needsShell = false) => {
  try {
    const { stdout, stderr } = await run(cmd, args, { cwd, maxBuffer: 1 << 26, shell: needsShell });
    return { code: 0, out: `${stdout}\n${stderr}` };
  } catch (err) {
    return { code: err.code ?? 1, out: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
  }
};

/** The last non-empty line of a suite's output, which is where these tools state their verdict. */
const verdict = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0] ?? '(no output)';

export async function repo(r) {
  // ── the front-end suite ───────────────────────────────────────────────
  const fe = await invoke('npm', ['test', '--silent'], REPO, true);
  if (fe.code !== 0) {
    // A red suite is not exposure and not data loss, so it reports without
    // failing the run — but it is never silent. The section headers name which
    // of the nine checks went red.
    const red = fe.out.split('\n').filter((l) => /^\[\d+\]/.test(l.trim())).join(' | ').slice(0, 400);
    r.add({
      layer: 'repo', severity: 'medium', kind: 'gate-red',
      subject: 'npm-test',
      what: 'npm test is red, so every layer above assumes something false',
      detail: red || fe.out.slice(-400),
    });
  } else {
    console.log(`   [repo/npm-test] ${verdict(fe.out)}`);
  }

  // ── the backend harness ───────────────────────────────────────────────
  const harness = join(BACKEND, 'db', 'tools', 'check-all.mjs');
  if (!existsSync(harness)) {
    r.skip('repo', `no backend harness at ${harness} — sibling repo absent or moved`,
      'whether the DDL, the enum registry and the two screen tables still agree');
    return;
  }
  const be = await invoke('node', [harness], BACKEND);
  if (be.code !== 0) {
    const red = be.out.split('\n').filter((l) => /PASS|FAIL/.test(l) && /FAIL/.test(l)).join(' | ').slice(0, 400);
    r.add({
      layer: 'repo', severity: 'medium', kind: 'gate-red',
      subject: 'backend-harness',
      what: 'the backend harness is red',
      detail: red || be.out.slice(-400),
    });
  } else {
    console.log(`   [repo/check-all] ${verdict(be.out)}`);
  }

  // Both suites regenerate their own derived TSVs. `check-all` in particular
  // refreshes db/spec/*.tsv with freshly generated rows — those are generated
  // artefacts, not edits, and they are restored rather than committed.
  const dirty = await invoke('git', ['status', '--porcelain', '--', 'db/spec'], BACKEND);
  if (dirty.out.trim()) {
    r.add({
      layer: 'repo', severity: 'low', kind: 'generated-drift',
      subject: 'generated-tsv',
      what: 'the harness rewrote db/spec/*.tsv; those are generated rows, restore them',
      detail: `cd ../hualong-backend && git checkout -- db/spec/\n${dirty.out.trim().split('\n').slice(0, 6).join('\n')}`,
    });
  }
}
