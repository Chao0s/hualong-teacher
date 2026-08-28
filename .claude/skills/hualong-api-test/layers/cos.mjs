/**
 * The bucket that holds every photograph and every backup.
 *
 * Split in two, deliberately.
 *
 * The unauthenticated probe runs from HERE, because "can a stranger read this"
 * is a question about what the internet sees, and asking it from inside the
 * VM's own region would answer a different question. It needs no credential, so
 * it runs before anything can skip.
 *
 * Everything else runs ON THE VM. The credential already lives there --
 * `/etc/hualong/cos.env`, sourced by backup-db.sh since 2026-08-18 -- and
 * copying a write-capable key to a second machine to answer a read-only
 * question is a bad trade. `vm-cos-probe.py` is piped in over ssh stdin, so
 * nothing is written to the server either, and it returns findings, never
 * values.
 *
 * The VM half also answers something the VM alone cannot: backup-db.sh writes
 * a local dump and then uploads it, so a failed upload leaves a healthy-looking
 * file behind. Only the bucket knows whether the copy arrived.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAnonymous, BUCKET } from '../lib/cos.mjs';
import { HOST, ADMIN_USER, adminReachable } from '../lib/vm.mjs';

const PROBE = join(fileURLToPath(new URL('..', import.meta.url)), 'vm-cos-probe.py');
const DAY_HOURS = 24;

function runProbe() {
  return new Promise((done) => {
    const child = execFile('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
      `${ADMIN_USER}@${HOST}`,
      'sudo bash -c "set -a; . /etc/hualong/cos.env; set +a; exec /opt/hualong/venv/bin/python -"',
    ], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return done({ error: String(err.message).slice(0, 200) });
      try {
        done(JSON.parse(stdout));
      } catch {
        done({ error: `the probe returned something that is not JSON: ${stdout.slice(0, 200)}` });
      }
    });
    child.stdin.end(readFileSync(PROBE));
  });
}

export async function cos(runReport) {
  // What an outsider sees, asked from outside.
  const anon = await getAnonymous('/', { 'list-type': 2, 'max-keys': 1 });
  if (anon.status === 200) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'exposure',
      what: `${BUCKET} lists its contents to an unauthenticated request`,
      detail: anon.body.slice(0, 300),
    });
  } else {
    runReport.add({
      layer: 'cos', severity: 'low', kind: 'coverage',
      what: `an unauthenticated list of ${BUCKET} is refused with ${anon.status}`,
    });
  }

  if (!await adminReachable()) {
    runReport.skip('cos', 'the ubuntu shell is unreachable, and the credential lives on the VM',
      'the bucket ACL, its encryption, its CORS rules, and whether the nightly dump reaches COS');
    return;
  }

  const probe = await runProbe();
  if (probe.error) {
    runReport.add({
      layer: 'cos', severity: 'medium', kind: 'check-failed',
      what: 'the COS probe could not run on the VM, so the bucket is unverified',
      detail: probe.error,
    });
    return;
  }

  for (const [name, result] of Object.entries(probe.checks || {})) {
    if (result.ran) continue;
    runReport.add({
      layer: 'cos', severity: 'medium', kind: 'check-failed',
      what: `the bucket ${name} could not be read (${result.why}) — that question is unanswered, not passed`,
      detail: result.why.startsWith('403')
        ? 'the hualong-cos-rw policy grants object operations but not bucket-config reads. ' +
          'Add cos:GetBucketACL, cos:GetBucketCORS and cos:GetBucketEncryption to hualong-bucket-config to close this.'
        : undefined,
    });
  }

  // How far the key reaches past the one bucket it needs. It sits on an
  // internet-facing VM, so this is a border question: a key scoped to one
  // bucket cannot become a way to enumerate the account.
  const reach = probe.checks?.reach;
  if (reach?.ran) {
    runReport.add({
      layer: 'cos', severity: 'medium', kind: 'over-permission',
      what: `the backup key can list all ${reach.value.bucketsVisible} bucket(s) on the account — ` +
        'cos:GetService is account-wide and nothing here needs it, since the bucket name is fixed',
      detail: reach.value.names,
    });
  } else {
    runReport.add({
      layer: 'cos', severity: 'low', kind: 'coverage',
      what: `the key cannot list other buckets (${reach?.why ?? 'refused'}) — scoped to its own`,
    });
  }

  // Every check that ran says what it found. A check that returns a healthy
  // value and prints nothing is indistinguishable in the report from a check
  // that never ran, which is the thing rule 5 exists to prevent.
  const acl = probe.checks?.acl;
  if (acl?.ran) {
    if (acl.value.publicGrants > 0) {
      runReport.add({
        layer: 'cos', severity: 'high', kind: 'exposure',
        what: `the bucket ACL carries ${acl.value.publicGrants} public grant(s)`,
      });
    } else {
      runReport.add({
        layer: 'cos', severity: 'low', kind: 'coverage',
        what: `the bucket ACL has ${acl.value.grants} grant(s), none of them public`,
      });
    }
  }

  const enc = probe.checks?.encryption;
  if (enc?.ran) {
    runReport.add(enc.value.configured
      ? { layer: 'cos', severity: 'low', kind: 'coverage', what: 'server-side encryption is configured' }
      : {
        layer: 'cos', severity: 'medium', kind: 'encryption',
        what: 'no default server-side encryption — CONTEXT.md §3 states SSE-COS, and this bucket ' +
          'holds photographs of children',
      });
  }

  const cors = probe.checks?.cors;
  if (cors?.ran) {
    if (cors.value.origins.includes('*')) {
      runReport.add({
        layer: 'cos', severity: 'high', kind: 'exposure',
        what: 'a CORS rule allows any origin — any website can make a visitor\'s browser call this bucket',
      });
    } else if (!cors.value.rules) {
      runReport.add({
        layer: 'cos', severity: 'medium', kind: 'cors',
        what: 'no CORS rules — clients upload straight to COS with presigned credentials, ' +
          'and a browser refuses that without them',
      });
    } else {
      runReport.add({
        layer: 'cos', severity: 'low', kind: 'coverage',
        what: `${cors.value.rules} CORS rule(s), origins: ${cors.value.origins.join(', ')}`,
      });
    }
  }

  const objects = probe.checks?.objects;
  if (!objects?.ran) return;
  const o = objects.value;

  if (o.truncated) {
    runReport.add({
      layer: 'cos', severity: 'medium', kind: 'check-failed',
      what: `the listing stopped at ${o.total} objects — anything past that is unchecked`,
    });
  }

  if (!o.dumpCount) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'data-loss',
      what: 'no backup object in COS — backup-db.sh writes a local dump and then uploads it, ' +
        'so a failed upload leaves a healthy-looking local file behind it',
      detail: { objectsSeen: o.total },
    });
    return;
  }

  if (o.newestAgeHours > 2 * DAY_HOURS) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'data-loss',
      what: `the newest backup in COS is ${Math.round(o.newestAgeHours / DAY_HOURS)} day(s) old`,
      detail: o.newest,
    });
  } else {
    runReport.add({
      layer: 'cos', severity: 'low', kind: 'coverage',
      what: `newest backup in COS is ${o.newestAgeHours}h old, ${o.dumpCount} copies held`,
      detail: o.newest.key,
    });
  }

  // An empty dump is the failure that looks most like success.
  if (o.newest.size < 1024) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'data-loss',
      what: `the newest backup is ${o.newest.size} bytes — a dump that small holds no data`,
      detail: o.newest.key,
    });
  }

  runReport.add({
    layer: 'cos', severity: 'low', kind: 'coverage',
    what: `${o.total} object(s) in ${BUCKET}`,
  });
}
