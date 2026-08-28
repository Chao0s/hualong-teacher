/**
 * The live database against `db/01_schema.sql`.
 *
 * `hualong-backend/AGENTS.md` names the DDL the sole field-level authority, so
 * a disagreement is the database being wrong, never the file. This layer only
 * ever reads: a generated ALTER applied against production is the one action in
 * this skill that could destroy real children's records, so it is written to a
 * file and handed over, never executed.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ssh, adminReachable } from '../lib/vm.mjs';
import { REPO } from '../lib/findings.mjs';

const DDL = resolve(REPO, '..', 'hualong-backend', 'db', '01_schema.sql');
const DB = 'hualong';

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
}
