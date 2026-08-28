/**
 * Entry point.
 *
 *   node .claude/skills/hualong-api-test/run.mjs             every layer
 *   node .claude/skills/hualong-api-test/run.mjs cos db      named layers
 *
 * Exits non-zero only when something is exposed or something is being lost.
 * Schema drift, a missing CORS rule and an untidy default page are reported and
 * do not fail the run: an exit code that stays red for weeks stops being read,
 * and then the one that mattered goes unread with it.
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

const LAYERS = { contract, db, cos, vm, api };

const asked = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const unknown = asked.filter((a) => !(a in LAYERS));
if (unknown.length) {
  console.error(`unknown layer(s): ${unknown.join(', ')}. Known: ${Object.keys(LAYERS).join(', ')}`);
  process.exit(2);
}
const chosen = asked.length ? asked : Object.keys(LAYERS);

const run = new Run();
console.log(`hualong-api-test — layers: ${chosen.join(', ')}\n`);

for (const name of chosen) {
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
}

process.exit(run.report());
