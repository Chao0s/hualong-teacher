/**
 * Element-level wiring: what the WXML invites, and whether anything answers.
 *
 * This CALLS `tools/scan-wiring.mjs`; it does not re-implement its six layers.
 * The scanner walks WXML event attributes to Page methods, then handler to
 * service to contract, then the reverse direction, then the prototype
 * difference, then the register's `writes=yes` pages. It is 961 lines of
 * deliberately calibrated heuristics — a copy of it here would drift within a
 * week.
 *
 * What this layer adds is the two ends: it asserts the scanner's own 24
 * self-tests still pass (a scanner that silently stopped scanning reports zero
 * findings, which reads exactly like a clean repo), and it lifts the scanner's
 * four bucket counts into the run's structure so two runs can be compared.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REPO } from '../lib/findings.mjs';

const run = promisify(execFile);

const invoke = async (args) => {
  try {
    const { stdout, stderr } = await run('npm', args, { cwd: REPO, maxBuffer: 1 << 26, shell: process.platform === 'win32' });
    return { code: 0, out: `${stdout}\n${stderr}` };
  } catch (err) {
    return { code: err.code ?? 1, out: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
  }
};

export async function wire(r) {
  // ── the scanner's own self-tests come first ────────────────────────────
  // L2's word lists decide whether an element "looks tappable". Before
  // 2026-09-09 L2 reported nothing at all, which was indistinguishable from a
  // clean repo. The self-tests are what keep that from happening again.
  const self = await invoke(['run', '--silent', 'scan:wiring', '--', '--selftest']);
  const m = self.out.match(/自测\s*(\d+)\s*\/\s*(\d+)/) ?? self.out.match(/(\d+)\s*\/\s*(\d+)/);
  if (self.code !== 0) {
    r.add({
      layer: 'wire', severity: 'high', kind: 'stale-expectation',
      subject: 'selftest',
      what: "the wiring scanner's own self-tests are red — its findings cannot be trusted",
      detail: self.out.split('\n').filter(Boolean).slice(-12).join('\n'),
    });
  } else if (m) {
    console.log(`   [wire/selftest] ${m[1]}/${m[2]} assertions pass`);
  }

  // ── the scan itself ────────────────────────────────────────────────────
  const scan = await invoke(['run', '--silent', 'scan:wiring']);
  if (scan.code !== 0) {
    r.add({
      layer: 'wire', severity: 'medium', kind: 'check-failed',
      subject: 'scan-failed',
      what: 'the wiring scan exited non-zero, so its buckets are not a full picture',
      detail: scan.out.split('\n').filter(Boolean).slice(-10).join('\n'),
    });
    return;
  }

  // The scanner prints four numbered buckets. The counts, not the exit code,
  // are what a human compares between runs.
  const buckets = [...scan.out.matchAll(/^([①②③④])\s*(.+?)：\s*(\d+)/gm)]
    .map((x) => ({ mark: x[1], what: x[2].trim(), n: Number(x[3]) }));
  for (const b of buckets) console.log(`   [wire/${b.mark}] ${b.what}: ${b.n}`);

  // ④ is "the client calls a path the contract does not declare". Every one of
  // those is exposure-adjacent by nature and is the class the contract layer
  // already tracks against known-gaps.json. Report the count here so a NEW one
  // is visible in this layer's line too.
  const undeclared = buckets.find((b) => b.mark === '④');
  if (undeclared && undeclared.n > 0) {
    console.log(`   [wire] ④ lists the undeclared calls; known ones are registered in known-gaps.json.`);
  }

  // The report file the scan just wrote is what /pages reads. Confirm it is
  // newer than the code it describes — the scanner writes it, so it must be.
  const fresh = await invoke(['run', '--silent', 'check:report']);
  console.log(`   [wire/report] ${fresh.out.split('\n').filter(Boolean)[0] ?? '(no verdict)'}`);
}
