/**
 * The live database against `db/01_schema.sql`.
 *
 * `hualong-backend/AGENTS.md` names the DDL the sole field-level authority, so
 * a disagreement is the database being wrong, never the file. This layer only
 * ever reads: a generated ALTER applied against production is the one action in
 * this skill that could destroy real children's records, so it is written to a
 * file and handed over, never executed.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ssh, adminReachable } from '../lib/vm.mjs';
import { REPO } from '../lib/findings.mjs';

const DDL = resolve(REPO, '..', 'hualong-backend', 'db', '01_schema.sql');
const DB = 'hualong';
const NEWLINE = new RegExp(String.fromCharCode(92) + 'r?' + String.fromCharCode(92) + 'n');

/** Tables and their columns as the DDL declares them. */
function fromDdl(text) {
  const tables = new Map();
  for (const m of text.matchAll(/CREATE TABLE (\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const cols = new Set();
    for (const line of m[2].split('\n')) {
      const c = /^\s{2}(\w+)\s+[A-Z]/.exec(line);
      if (c && !['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK'].includes(c[1].toUpperCase())) {
        cols.add(c[1]);
      }
    }
    tables.set(m[1], cols);
  }
  return tables;
}

export async function db(runReport) {
  if (!existsSync(DDL)) {
    runReport.skip('db', `${DDL} is not mounted`, 'whether the live schema still matches the DDL');
    return;
  }
  if (!await adminReachable()) {
    runReport.skip('db', 'the ubuntu shell is unreachable — this layer needs it, the tunnel reaches one app port only',
      'whether the live schema matches the DDL, and which tables exist at all');
    return;
  }

  const declared = fromDdl(readFileSync(DDL, 'utf8'));

  // Written without a literal 'public', so the command survives quoting through
  // ssh and the shell underneath it.
  const q = "select table_name||'.'||column_name from information_schema.columns " +
    "where table_schema = current_schema() order by 1";
  let live;
  try {
    live = (await ssh(`sudo -u postgres psql -d ${DB} -Atc "${q}"`)).trim().split('\n').filter(Boolean);
  } catch (err) {
    runReport.skip('db', `psql failed: ${String(err.message).slice(0, 200)}`, 'the entire live schema');
    return;
  }

  const liveTables = new Map();
  for (const row of live) {
    const [t, c] = row.split('.');
    if (!liveTables.has(t)) liveTables.set(t, new Set());
    liveTables.get(t).add(c);
  }

  const missing = [...declared.keys()].filter((t) => !liveTables.has(t));
  const extra = [...liveTables.keys()].filter((t) => !declared.has(t));

  if (missing.length) {
    runReport.add({
      layer: 'db', severity: 'medium', kind: 'schema-drift',
      what: `${missing.length} table(s) the DDL declares are absent from the live database`,
      detail: missing,
    });
  }
  if (extra.length) {
    runReport.add({
      layer: 'db', severity: 'medium', kind: 'schema-drift',
      what: `${extra.length} live table(s) the DDL does not declare`,
      detail: extra,
    });
  }

  const colDrift = [];
  for (const [t, cols] of declared) {
    const liveCols = liveTables.get(t);
    if (!liveCols) continue;
    for (const c of cols) if (!liveCols.has(c)) colDrift.push({ table: t, column: c, side: 'missing live' });
    for (const c of liveCols) if (!cols.has(c)) colDrift.push({ table: t, column: c, side: 'undeclared' });
  }
  if (colDrift.length) {
    runReport.add({
      layer: 'db', severity: 'medium', kind: 'schema-drift',
      what: `${colDrift.length} column(s) differ between the DDL and the live database`,
      detail: colDrift,
    });
  }

  runReport.add({
    layer: 'db', severity: 'low', kind: 'coverage',
    what: `live ${DB}: ${liveTables.size} table(s); DDL declares ${declared.size}`,
  });

  await rowLevelSecurity(runReport);
  await migrations(runReport);
}

/**
 * Whether the authorization model ADR-0016 chose actually exists yet.
 *
 * §3 puts the rule on the tables rather than in the code, so a query that
 * forgets its condition still cannot reach another class. Until the policies
 * are written that protection is a plan, not a fact, and the gap between the
 * two is exactly what this reports.
 *
 * The sharp half is FORCE. Without `FORCE ROW LEVEL SECURITY` the table's owner
 * bypasses its own policies -- and the service connects as the owner. Tests
 * pass, production leaks, and nothing anywhere says so. ADR-0016 §3.5 lists it
 * as the second thing to check; this asks it on every run instead.
 */
async function rowLevelSecurity(runReport) {
  const q = 'select c.relname, c.relrowsecurity, c.relforcerowsecurity, ' +
    "coalesce((select count(*) from pg_policies p where p.tablename = c.relname), 0) as policies " +
    'from pg_class c join pg_namespace n on n.oid = c.relnamespace ' +
    "where c.relkind = 'r' and n.nspname = current_schema() order by 1";
  let rows;
  try {
    rows = (await ssh(`sudo -u postgres psql -d ${DB} -Atc "${q}"`)).trim().split(new RegExp('\\r?\\n')).filter(Boolean)
      .map((l) => {
        const [name, rls, force, policies] = l.split('|');
        return { name, rls: rls === 't', force: force === 't', policies: Number(policies) };
      });
  } catch (err) {
    runReport.skip('db/rls', `the policy catalogue could not be read: ${String(err.message).slice(0, 120)}`,
      'whether the authorization model ADR-0016 chose is in force');
    return;
  }

  const on = rows.filter((r) => r.rls);
  if (!on.length) {
    runReport.add({
      layer: 'db', severity: 'medium', kind: 'authz-not-built',
      what: `row-level security is switched on for 0 of ${rows.length} tables — ADR-0016 §3 makes it ` +
        'the authorization model, and until the policies exist that protection is a plan, not a fact',
    });
    return;
  }

  // Enabled but not forced is worse than not enabled: it looks protected.
  const notForced = on.filter((r) => !r.force);
  for (const t of notForced) {
    runReport.add({
      layer: 'db', severity: 'high', kind: 'hardening-off',
      what: `${t.name} has row-level security enabled but not FORCED — the owner bypasses it, ` +
        'and the service connects as the owner, so this reads as protected and is not',
    });
  }

  const enabledNoPolicy = on.filter((r) => !r.policies);
  for (const t of enabledNoPolicy) {
    runReport.add({
      layer: 'db', severity: 'high', kind: 'authz-not-built',
      what: `${t.name} has row-level security enabled but no policy — that denies everything, ` +
        'which fails safe but breaks the feature',
    });
  }

  runReport.add({
    layer: 'db', severity: 'low', kind: 'coverage',
    what: `row-level security on ${on.length}/${rows.length} table(s), ` +
      `${on.filter((r) => r.force).length} forced, ` +
      `${on.reduce((n, r) => n + r.policies, 0)} policy/policies total`,
  });
}

/**
 * Numbered SQL files on disk against the ones the database says it ran.
 *
 * ADR-0016 §10 chose numbered files plus a table recording which have been
 * applied. Two drifts matter and neither announces itself: a file nobody
 * applied, and a recorded row with no file behind it. The second is the worse
 * one -- it means the machine ran something no longer in the repository.
 */
async function migrations(runReport) {
  const dir = resolve(REPO, '..', 'hualong-backend', 'db', 'migrations');
  const onDisk = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    : null;

  let applied = null;
  try {
    const out = await ssh(`sudo -u postgres psql -d ${DB} -Atc ` +
      `"select filename from schema_migrations order by 1" 2>/dev/null || true`);
    applied = out.trim() ? out.trim().split(NEWLINE).filter(Boolean) : [];
  } catch { applied = null; }

  if (onDisk === null && !applied?.length) {
    runReport.skip('db/migrations',
      `no ${dir} and no schema_migrations table — ADR-0016 §10 is chosen but not built`,
      'whether every schema change on disk has actually been applied, and vice versa');
    return;
  }

  const missing = (onDisk || []).filter((f) => !(applied || []).includes(f));
  const orphaned = (applied || []).filter((f) => !(onDisk || []).includes(f));

  if (missing.length) {
    runReport.add({
      layer: 'db', severity: 'medium', kind: 'migration-drift',
      what: `${missing.length} migration file(s) on disk have not been applied`,
      detail: missing,
    });
  }
  if (orphaned.length) {
    runReport.add({
      layer: 'db', severity: 'high', kind: 'migration-drift',
      what: `${orphaned.length} migration(s) recorded as applied have no file — ` +
        'the database ran something that is no longer in the repository',
      detail: orphaned,
    });
  }
  if (!missing.length && !orphaned.length) {
    runReport.add({
      layer: 'db', severity: 'low', kind: 'coverage',
      what: `${(onDisk || []).length} migration(s), all applied`,
    });
  }
}

