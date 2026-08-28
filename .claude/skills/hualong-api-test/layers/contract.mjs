/**
 * Every client's service layer against the contract, and every contract
 * operation against the mock.
 *
 * This is the layer that has already caught a real bug five times. A client
 * calling a path the contract does not declare produces no error anywhere: the
 * request 404s in production, the screen renders blank, and no test goes red.
 * On 2026-08-27 three `/teacher-profile` operations were cited in a client
 * commit as having been added to the contract by a backend commit that does not
 * exist.
 *
 * Two of the three clients hold no service layer yet. They are checked anyway,
 * and skip with a reason, so the day one of them gains code it is covered
 * without anyone remembering to come back here.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { REPO } from '../lib/findings.mjs';

const run = promisify(execFile);
const HERE_DIR = fileURLToPath(new URL('..', import.meta.url));

/**
 * Fifteen paths already disagree with the contract, each deliberately and each
 * explained in mock/server.mjs. Without this register every run reports them
 * again and the one new drift hides among them.
 */
const KNOWN = JSON.parse(readFileSync(join(HERE_DIR, 'known-gaps.json'), 'utf8')).register;


const CLIENTS = [
  { name: 'hualong-teacher', services: join(REPO, 'miniprogram', 'services') },
  { name: 'hualong-parent', services: resolve(REPO, '..', 'hualong-parent', 'miniprogram', 'services') },
  { name: 'hualong-admin-pc', services: resolve(REPO, '..', 'hualong-admin-pc', 'src', 'services') },
];

/** `${id}` and `{id}` both stand for "some path parameter". */
const normalise = (p) => p.replace(/\$\{[^}]*\}/g, '{}').replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/**
 * Paths a client actually calls.
 *
 * Clients build paths from a constant and a template literal — `api.get(
 * `${SECTION_PATH}/${id}/widgets`)` — so a regex over call sites alone misses
 * most of them. Constants are resolved first, then substituted.
 */
function calledPaths(file) {
  const src = readFileSync(file, 'utf8');
  const consts = new Map();
  for (const m of src.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"`](\/[^'"`]*)['"`]/g)) {
    consts.set(m[1], m[2]);
  }
  const found = new Set();

  // Only the first argument of an actual call counts. Reading every
  // `const X = '/...'` instead sweeps up wx.navigateTo routes such as
  // '/packages/quality/pages/tool/index' and reports them as missing
  // endpoints -- noise that teaches people to skim the report.
  const CALL = /(?:api\.(?:get|post|put|patch|delete|del)|getPage|getRoster)\(\s*([^,)]+)/g;
  for (const m of src.matchAll(CALL)) {
    const arg = m[1].trim();

    // A bare constant: api.get(SECTION_PATH)
    if (consts.has(arg)) {
      found.add(consts.get(arg));
      continue;
    }

    // A literal or a template: `${SECTION_PATH}/${id}/widgets`, '/notices'
    const literal = /^[`'"]([\s\S]*)[`'"]$/.exec(arg);
    if (!literal) continue;
    let path = literal[1];
    for (const [name, value] of consts) path = path.replaceAll('${' + name + '}', value);
    if (path.startsWith('/')) found.add(path);
  }

  return found;
}

export async function contract(runReport) {
  let spec;
  try {
    const src = await import(pathToFileURL(join(REPO, 'tools', 'openapi-source.mjs')).href);
    spec = src.loadSpec();
  } catch (err) {
    runReport.skip('contract', `the contract could not be read: ${err.message}`,
      'whether any client calls an undeclared path, and whether the mock still answers every operation');
    return;
  }

  const declared = new Set(Object.keys(spec.paths || {}).map(normalise));

  for (const client of CLIENTS) {
    if (!existsSync(client.services)) {
      runReport.skip(`contract/${client.name}`,
        `no service layer at ${client.services} — this client is still an HTML prototype`,
        `whether ${client.name} calls paths the contract does not declare`);
      continue;
    }
    const files = walk(client.services);
    const seen = new Map();
    for (const f of files) for (const p of calledPaths(f)) {
      if (!seen.has(p)) seen.set(p, []);
      seen.get(p).push(f.replace(REPO, '.'));
    }
    for (const [p, where] of seen) {
      if (declared.has(normalise(p))) continue;
      const known = KNOWN[normalise(p)];
      runReport.add({
        layer: 'contract',
        severity: known ? 'medium' : 'high',
        kind: known ? 'known-gap' : 'undeclared-path',
        what: known
          ? `${client.name} calls ${p} — registered gap: ${known}`
          : `${client.name} calls ${p}, which the contract does not declare`,
        detail: { calledIn: where },
      });
    }
    runReport.add({
      layer: 'contract',
      severity: 'low',
      kind: 'coverage',
      what: `${client.name}: ${seen.size} distinct path(s) called across ${files.length} service file(s)`,
    });
  }

  // The mock is the engine, not a target: it is how all 128 declared paths get
  // exercised without a service to exercise them against.
  try {
    await run('node', ['--test', 'tests/api-coverage.test.mjs'], { cwd: REPO, timeout: 120000 });
    runReport.add({ layer: 'contract', severity: 'low', kind: 'coverage', what: 'every declared operation answers its declared success code against the mock' });
  } catch (err) {
    const out = String(err.stdout || err.message);
    const fail = out.split('\n').find((l) => l.includes('not ok') || l.includes('AssertionError')) || 'see the report';
    runReport.add({
      layer: 'contract',
      severity: 'medium',
      kind: 'mock-regression',
      what: 'the contract no longer agrees with the mock',
      detail: fail.trim(),
    });
  }
}
