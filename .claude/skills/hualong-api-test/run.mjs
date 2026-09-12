/**
 * Entry point.
 *
 *   node .claude/skills/hualong-api-test/run.mjs              the fast set
 *   node .claude/skills/hualong-api-test/run.mjs --all        all eleven layers
 *   node .claude/skills/hualong-api-test/run.mjs cos db       named layers
 *
 * **Two sets, declared here so nobody has to remember them.** The fast set is
 * what you run after every change: it needs no credentials, touches no cloud,
 * and answers "is the code still consistent with the contract and with itself".
 * The full set adds the layers that need production access, a local database,
 * or a GUI — run it to close a stage or hand over.
 *
 *   fast   contract  wire  cover  proto  repo               no credentials
 *   full   + db  cos  vm  api  render                       needs the box, the
 *                                                            bucket, or DevTools
 *
 * Exit is non-zero only for exposure, data loss, hardening that is off, a call
 * to an undeclared path, or a **stale expectation**. That last one is not the
 * same family as "schema drift" and is deliberately not tolerated: a register
 * that keeps naming a closed gap, or a report older than the code it describes,
 * is a check that has silently stopped checking. Pattern drift can be known and
 * lived with; a dead expectation cannot, because nothing else will ever notice
 * it. An exit code that stays red for weeks stops being read, so these are kept
 * rare on purpose.
 *
 * A layer that cannot run says so and says what that leaves unknown. Absence is
 * never reported as success.
 */

import { Run } from './lib/findings.mjs';
import { contract } from './layers/contract.mjs';
import { db } from './layers/db.mjs';
import { cos } from './layers/cos.mjs';
import { vm } from './layers/vm.mjs';
import { api } from './layers/api.mjs';
import { repo } from './layers/repo.mjs';
import { wire } from './layers/wire.mjs';
import { cover } from './layers/cover.mjs';
import { proto } from './layers/proto.mjs';
import { render } from './layers/render.mjs';
import { probes } from './layers/probes.mjs';

const LAYERS = { contract, wire, cover, proto, repo, db, cos, vm, api, render, probes };

/** Run after every change. No credentials, no cloud, no GUI. */
const FAST = ['contract', 'wire', 'cover', 'proto', 'repo'];

const argv = process.argv.slice(2);
const asked = argv.filter((a) => !a.startsWith('-'));
const unknown = asked.filter((a) => !(a in LAYERS));
if (unknown.length) {
  console.error(`unknown layer(s): ${unknown.join(', ')}. Known: ${Object.keys(LAYERS).join(', ')}`);
  process.exit(2);
}

// Order matters: `wire` regenerates the two tables and the report that `cover`
// then reads. Asking for `cover` alone will correctly report a stale report.
const chosen = argv.includes('--all') ? Object.keys(LAYERS) : (asked.length ? asked : FAST);

const run = new Run();
console.log(`hualong-api-test — layers: ${chosen.join(', ')}`);
console.log(`(${chosen.length === FAST.length && !asked.length ? 'fast set; --all for the full eleven' : `${chosen.length} of ${Object.keys(LAYERS).length}`})\n`);

const perLayer = {};
for (const name of chosen) {
  console.log(`── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`);
  const before = run.findings.length;
  try {
    await LAYERS[name](run);
  } catch (err) {
    // A layer that throws is a broken check, not a clean system. Never silent.
    run.add({
      layer: name, severity: 'medium', kind: 'check-failed',
      what: `the ${name} layer threw, so its questions are unanswered`,
      detail: String(err && err.message ? err.message : err).slice(0, 500),
    });
  }
  perLayer[name] = run.findings.length - before;
  console.log('');
}

run.perLayer = perLayer;
process.exit(run.report());
