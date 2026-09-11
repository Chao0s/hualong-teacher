/**
 * Screen coverage: one row per screen, and both of its locators.
 *
 * The mapping tables answer "what does each screen call". This layer asks the
 * prior question: does every screen still have a row, and does each row still
 * point at files that exist. A row whose file moved is worse than a missing
 * row, because it reads as coverage.
 *
 * Three shapes, and they are NOT the same problem (decided 2026-09-12):
 *
 *   1. a miniprogram screen whose `mp_file` is empty       → self-contradictory
 *   2. a prototype locator that does not exist on disk     → the register lost
 *                                                            its anchor
 *   3. `pc-backend` rows naming an in-page anchor
 *      (`index.html#dashboard`)                            → exempt, and SAID SO
 *
 * (3) is exempt because the admin client is a single-page app: those are
 * sections of one file, not missing screens. It is not silently dropped —
 * an exemption nobody can see is the same defect as a silent skip.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REPO } from '../lib/findings.mjs';

const run = promisify(execFile);
const BACKEND = resolve(REPO, '..', 'hualong-backend');
const SPEC = join(BACKEND, 'db', 'spec');

const readTsv = (p) => {
  if (!existsSync(p)) throw new Error(`missing ${p} — the backend spec directory is not where it should be`);
  const rows = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const head = rows[0].split('\t');
  return rows.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? ''])));
};

export async function cover(r) {
  if (!existsSync(SPEC)) {
    r.skip('cover', `no ${SPEC}`,
      'whether every screen still has a mapping row, and whether its locators still resolve');
    return;
  }

  // ── the freshness of the report /pages reads ───────────────────────────
  // `--emit` writes the two tables but NOT the wiring report. A stale report
  // makes the service-layer column look current when it is not. Measured
  // 56 minutes stale on 2026-09-12.
  // NOTE: no `shell` here. This repo lives under a path containing a space
  // ("My Drive"), and running `node <absolute path>` through a shell splits it —
  // node never starts, the exec throws, and this catch then reports a stale
  // report that is not stale. That produced a false high on 2026-09-12; the
  // same bug was fixed in repo.mjs and render.mjs, and missed here.
  // Verify the instrument before the finding.
  try {
    await run('node', [join(REPO, 'tools', 'check-report-freshness.mjs'), '--strict'], { cwd: REPO });
    console.log('   [cover/report] fresh — not older than the files it scanned');
  } catch (err) {
    r.add({
      layer: 'cover', severity: 'high', kind: 'stale-expectation',
      what: 'the wiring report is older than the code it describes, so /pages shows a stale column',
      detail: String(err.stdout ?? err.message).split('\n').filter(Boolean).slice(0, 8).join('\n'),
    });
  }

  // ── both locators, one row at a time ───────────────────────────────────
  const screens = readTsv(join(SPEC, 'screens.tsv'));
  const ROOT = resolve(REPO, '..');
  const cand = (repo, rel) => [
    join(BACKEND, rel), join(REPO, rel), join(ROOT, repo, rel), join(ROOT, rel),
  ];
  const exists = (repo, rel) => Boolean(rel) && cand(repo, rel).some(existsSync);

  // A client only owes an `mp_file` once it HAS a mini-program tree. The parent
  // client is still an HTML prototype, so its rows carry no `mp_file` — that is
  // the honest state, not a contradiction. Demanding one anyway reported 18
  // non-defects on 2026-09-12, which is how a gate teaches people to ignore it.
  const hasMiniprogram = (repo) => Boolean(repo) && existsSync(join(ROOT, repo, 'miniprogram', 'pages'));

  const selfContradictory = [];
  const lostPrototype = [];
  const exempted = [];
  const waiting = new Map();
  for (const s of screens) {
    const id = s.surface ?? s.screen_file ?? '(unnamed)';
    const isMini = s.surface === 'miniprogram';
    const pOk = exists(s.repo, s.screen_file);
    const mOk = exists(s.repo, s.mp_file);
    // The prototype locator is owed by everyone; the mp one only by clients
    // that have a mini-program.
    if (!pOk && (s.screen_file ?? '').includes('#')) exempted.push(`${id} → ${s.screen_file} (in-page anchor)`);
    else if (!pOk && !hasMiniprogram(s.repo)) waiting.set(s.repo, (waiting.get(s.repo) ?? 0) + 1);
    else if (!pOk) lostPrototype.push(`${id} → ${s.screen_file}`);

    if (!isMini) continue;
    if (!hasMiniprogram(s.repo)) continue;
    if (!s.mp_file) selfContradictory.push(`${id} (says miniprogram, names no file)`);
    else if (!mOk) selfContradictory.push(`${id} (mp_file does not resolve: ${s.mp_file})`);
  }

  for (const x of selfContradictory) {
    r.add({
      layer: 'cover', severity: 'high', kind: 'stale-expectation',
      what: 'a row says this is a mini-program screen and names no file that exists',
      detail: `${x}\nthe register contradicts itself; either the screen is gone or the locator is wrong`,
    });
  }
  for (const x of lostPrototype) {
    r.add({
      layer: 'cover', severity: 'high', kind: 'stale-expectation',
      what: 'a registered prototype file is not on disk — the intent anchor is lost',
      detail: `${x}\nCLAUDE.md §7.3: a copy is not redundancy, it is a silent expiry. Either find the file or drop the row.`,
    });
  }
  console.log(`   [cover/locators] ${screens.length} rows: ${screens.length - selfContradictory.length - lostPrototype.length - exempted.length} whole, ` +
    `${selfContradictory.length} self-contradictory, ${lostPrototype.length} prototype lost, ${exempted.length} exempt (SPA anchors)`);
  for (const [repo, n] of waiting) {
    console.log(`        ${repo}: ${n} row(s) name no locator on disk — that client has no mini-program tree yet, so nothing is owed`);
  }
  for (const e of exempted) console.log(`        exempt: ${e}`);

  // ── one row per screen in the operations table ─────────────────────────
  const ops = readTsv(join(SPEC, 'screen-operations.tsv'));
  const byScreen = new Map();
  for (const o of ops) byScreen.set(o.screen, (byScreen.get(o.screen) ?? 0) + 1);
  const mpScreens = readdirSync(join(REPO, 'miniprogram', 'pages'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);
  const missing = mpScreens.filter((s) => !byScreen.has(s));
  if (missing.length) {
    r.add({
      layer: 'cover', severity: 'high', kind: 'stale-expectation',
      what: 'a mini-program screen has no row in the operations table at all',
      detail: `${missing.join(', ')}\n未登记与「按设计不调任何操作」是两件事；这里要的是前者。`,
    });
  }
  console.log(`   [cover/rows] ${mpScreens.length} screens on disk, ${mpScreens.length - missing.length} have rows, ${ops.length} rows total`);

  // ── the ELI10 table covers every operation ─────────────────────────────
  // The table's first column is `key`, not `operation_id`. Reading the wrong
  // name made 168 rows look like 0 and produced "135 operations without an
  // entry" on 2026-09-12 — a finding that described my reader, not the repo.
  const eli = readTsv(join(SPEC, 'operation-eli10.tsv'));
  const opIds = new Set(eli.map((e) => e.key).filter(Boolean));
  const missingEli = ops.map((o) => o.operation_id).filter((id) => id && id !== 'NONE' && !opIds.has(id));
  if (missingEli.length) {
    r.add({
      layer: 'cover', severity: 'medium', kind: 'coverage',
      what: 'mapped operations with no plain-language entry',
      detail: [...new Set(missingEli)].slice(0, 12).join(', '),
    });
  }
  console.log(`   [cover/eli10] ${opIds.size} operations have an entry; ${missingEli.length} mapped operation(s) are without one`);
}
