/**
 * The bucket that holds every photograph and every backup.
 *
 * Two questions matter more than the rest. Can a stranger read it — asked by
 * actually trying, unauthenticated, because a policy that reads as private and
 * a bucket that behaves as private are different claims. And is the backup
 * real — `CONTEXT.md` states a daily 05:00 `pg_dump` lands here and that restore
 * has been tested, which is exactly the kind of statement that stays true in a
 * document long after it stopped being true on the machine.
 */

import { get, getAnonymous, credentials, BUCKET } from '../lib/cos.mjs';

const DAY = 24 * 60 * 60 * 1000;

export async function cos(runReport) {
  try {
    credentials();
  } catch (err) {
    runReport.skip('cos', err.message,
      'the bucket ACL, its policy, SSE, CORS, and whether any backup exists at all');
    return;
  }

  // Whether a stranger gets in. The only active probe this skill makes.
  const anon = await getAnonymous('/?list-type=2&max-keys=1');
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

  const acl = await get('/', { acl: '' });
  if (acl.status === 200 && /AllUsers|Everyone/.test(acl.body)) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'exposure',
      what: 'the bucket ACL grants a public principal',
      detail: acl.body.slice(0, 400),
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
      what: 'no CORS rules on the bucket — clients upload to it directly with presigned credentials',
    });
  }

  // The backup. Newest object that looks like a dump.
  const listing = await get('/', { 'list-type': 2, 'max-keys': 1000 });
  if (listing.status !== 200) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'data-loss',
      what: `cannot list ${BUCKET} even with credentials (HTTP ${listing.status}) — backup state unknown`,
      detail: listing.body.slice(0, 300),
    });
    return;
  }

  const keys = [...listing.body.matchAll(/<Key>([^<]+)<\/Key>[\s\S]*?<LastModified>([^<]+)<\/LastModified>/g)]
    .map(([, key, when]) => ({ key, when: new Date(when) }));
  const dumps = keys.filter((k) => /dump|backup|\.sql|\.gz/i.test(k.key));

  if (!dumps.length) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'data-loss',
      what: `no backup object found in ${BUCKET} — CONTEXT.md states a daily 05:00 pg_dump lands here`,
      detail: { objectsSeen: keys.length, sample: keys.slice(0, 5).map((k) => k.key) },
    });
    return;
  }

  const newest = dumps.reduce((a, b) => (a.when > b.when ? a : b));
  const age = Date.now() - newest.when.getTime();
  if (age > DAY) {
    runReport.add({
      layer: 'cos', severity: 'high', kind: 'data-loss',
      what: `the newest backup is ${Math.floor(age / DAY)} day(s) old`,
      detail: { key: newest.key, lastModified: newest.when.toISOString() },
    });
  } else {
    runReport.add({
      layer: 'cos', severity: 'low', kind: 'coverage',
      what: `newest backup ${newest.key} is ${Math.round(age / 3600000)}h old`,
    });
  }
}
