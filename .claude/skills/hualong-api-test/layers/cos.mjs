/**
 * The bucket that holds every photograph and every backup.
 *
 * Two questions matter more than the rest. Can a stranger read it — asked by
 * actually trying, unauthenticated, because a policy that reads as private and
 * a bucket that behaves as private are different claims. And do the nightly
 * dumps actually arrive — `/opt/hualong/backup-db.sh` runs at 05:00 and writes
 * to `/var/backups/hualong`, and whether the COS half of that script succeeds
 * is invisible from the VM: a failed upload leaves a healthy-looking local file
 * behind it.
 */

import { get, getAnonymous, listAll, credentials, BUCKET } from '../lib/cos.mjs';

const DAY = 24 * 60 * 60 * 1000;

export async function cos(runReport) {
  // The most important question here needs no credential, so it is asked before
  // the ones that do. Hiding "can a stranger read this" behind a missing
  // environment variable would mean the check most worth having is the one that
  // silently does not run.
  const anonList = await getAnonymous('/', { 'list-type': 2, 'max-keys': 1 });
  if (anonList.status === 200) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'exposure',
      what: `${BUCKET} lists its contents to an unauthenticated request`,
      detail: anonList.body.slice(0, 300),
    });
  } else {
    runReport.add({
      layer: 'cos', severity: 'low', kind: 'coverage',
      what: `an unauthenticated list of ${BUCKET} is refused with ${anonList.status}`,
    });
  }

  try {
    credentials();
  } catch (err) {
    runReport.skip('cos', err.message,
      'the bucket ACL, its encryption, its CORS rules, and whether any backup has ever reached COS ' +
      '(the unauthenticated exposure probe above did run)');
    return;
  }

  const acl = await get('/', { acl: '' });
  if (acl.status === 200 && /AllUsers|Everyone/.test(acl.body)) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'exposure',
      what: 'the bucket ACL grants a public principal',
      detail: acl.body.slice(0, 400),
    });
  } else if (acl.status !== 200) {
    runReport.add({
      layer: 'cos', severity: 'medium', kind: 'check-failed',
      what: `the bucket ACL could not be read (HTTP ${acl.status}) — public access is unverified`,
      detail: acl.body.slice(0, 200),
    });
  }

  const enc = await get('/', { encryption: '' });
  if (enc.status === 404 || !/SSEAlgorithm/.test(enc.body)) {
    runReport.add({
      layer: 'cos', severity: 'medium', kind: 'encryption',
      what: 'no default server-side encryption is configured — CONTEXT.md §3 states SSE-COS',
      detail: `HTTP ${enc.status}`,
    });
  }

  const cors = await get('/', { cors: '' });
  if (cors.status === 404) {
    runReport.add({
      layer: 'cos', severity: 'medium', kind: 'cors',
      what: 'no CORS rules on the bucket — clients are meant to upload to it directly ' +
        'with presigned credentials, and a browser will refuse that without them',
    });
  }

  // Everything, across every page. One page holds 1000 keys, and reading only
  // the first would report the backup missing the moment the media outnumber it.
  const listing = await listAll();
  if (listing.status !== 200) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'data-loss',
      what: `cannot list ${BUCKET} even with credentials (HTTP ${listing.status}) — backup state unknown`,
      detail: String(listing.body).slice(0, 300),
    });
    return;
  }
  if (listing.truncated) {
    runReport.add({
      layer: 'cos', severity: 'medium', kind: 'check-failed',
      what: `the listing stopped at ${listing.objects.length} objects — anything past that is unchecked`,
    });
  }

  // A stranger reading one real object is a sharper question than listing:
  // buckets are routinely private to list and public to read.
  if (listing.objects.length) {
    const sample = listing.objects[0];
    const anonRead = await getAnonymous(`/${sample.key.split('/').map(encodeURIComponent).join('/')}`);
    if (anonRead.status < 400) {
      runReport.add({
        layer: 'cos', severity: 'high', kind: 'exposure',
        what: `an unauthenticated stranger can read ${sample.key} (HTTP ${anonRead.status})`,
      });
    } else {
      runReport.add({
        layer: 'cos', severity: 'low', kind: 'coverage',
        what: `an unauthenticated read of a real object is refused with ${anonRead.status}`,
      });
    }
  }

  const dumps = listing.objects.filter((o) => /dump|backup|\.sql/i.test(o.key));
  if (!dumps.length) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'data-loss',
      what: `no backup object in ${BUCKET} — backup-db.sh writes locally at 05:00 and uploads here; ` +
        'a failed upload leaves a healthy-looking local file behind it',
      detail: { objectsSeen: listing.objects.length, sample: listing.objects.slice(0, 5).map((o) => o.key) },
    });
    return;
  }

  const newest = dumps.reduce((a, b) => (a.when > b.when ? a : b));
  const age = Date.now() - newest.when.getTime();
  if (age > 2 * DAY) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'data-loss',
      what: `the newest backup in COS is ${Math.floor(age / DAY)} day(s) old`,
      detail: { key: newest.key, lastModified: newest.when.toISOString(), copiesHeld: dumps.length },
    });
  } else {
    runReport.add({
      layer: 'cos', severity: 'low', kind: 'coverage',
      what: `newest backup in COS ${newest.key} is ${Math.round(age / 3600000)}h old, ${dumps.length} copies held`,
    });
  }

  // An empty dump is the failure that looks most like success.
  if (newest.size < 1024) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'data-loss',
      what: `the newest backup is ${newest.size} bytes — a dump that small holds no data`,
      detail: newest.key,
    });
  }

  runReport.add({
    layer: 'cos', severity: 'low', kind: 'coverage',
    what: `${listing.objects.length} object(s) in ${BUCKET}`,
  });
}
