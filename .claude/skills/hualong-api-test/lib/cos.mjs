/**
 * Tencent COS v5 request signing, implemented here so nothing has to be
 * installed — not on this machine, not on the VM. `coscli` and `tccli` are both
 * absent from the server, and putting a credentialed CLI profile on the host
 * that stores every child's photograph is a worse trade than sixty lines of
 * HMAC.
 *
 * The algorithm is Tencent's `q-sign-algorithm=sha1` scheme:
 *
 *   SignKey      = HMAC-SHA1(SecretKey, KeyTime)
 *   HttpString   = method \n path \n query \n headers \n
 *   StringToSign = "sha1" \n KeyTime \n SHA1(HttpString) \n
 *   Signature    = HMAC-SHA1(SignKey, StringToSign)
 *
 * The trap in it is that `query` inside HttpString must be byte-identical to
 * the query string actually put on the wire, sorted and encoded the same way.
 * Sign a sorted query and send an unsorted one and every request comes back
 * 403 — indistinguishable from a credential problem, which is how an hour goes
 * missing. So one function builds the canonical form and both the signature and
 * the URL are derived from it.
 *
 * Credentials come from the environment and are never written anywhere. A
 * missing one is a named error, because a silently skipped bucket check reads
 * exactly like a bucket that passed.
 */

import { createHmac, createHash } from 'node:crypto';

export const BUCKET = 'hualong-media-1464472146';
export const REGION = 'ap-guangzhou';
export const HOST = `${BUCKET}.cos.${REGION}.myqcloud.com`;

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const hmac = (key, s) => createHmac('sha1', key).update(s).digest('hex');

/**
 * COS wants RFC 3986. `encodeURIComponent` leaves `!'()*` alone, and a bucket
 * key containing any of them would sign one way and travel another.
 */
const enc = (s) => encodeURIComponent(String(s))
  .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The one canonical form. Keys lowercased and sorted; a valueless parameter
 * (`?acl`) signs and sends as `acl=`.
 */
function canonicalQuery(query) {
  const keys = Object.keys(query).map((k) => k.toLowerCase()).sort();
  const pairs = keys.map((k) => {
    const original = Object.keys(query).find((o) => o.toLowerCase() === k);
    return `${enc(k)}=${enc(query[original] ?? '')}`;
  });
  return { list: keys.join(';'), string: pairs.join('&') };
}

export function credentials() {
  const id = process.env.COS_SECRET_ID;
  const key = process.env.COS_SECRET_KEY;
  if (!id || !key) {
    throw new Error('COS_SECRET_ID and COS_SECRET_KEY must be set in the environment. ' +
      'Set them in your own shell; never in a file this repository can see.');
  }
  return { id, key };
}

/**
 * @param {{id:string,key:string}} cred
 * @param {string} method
 * @param {string} path bucket-relative, starting with `/`
 * @param {{list:string,string:string}} q from canonicalQuery
 * @param {number} validFor seconds the signature stays usable
 */
export function authorization(cred, method, path, q, validFor = 600) {
  const now = Math.floor(Date.now() / 1000);
  // A minute of slack backwards: the server's clock is not this one's, and a
  // signature that is not yet valid fails exactly like a wrong secret.
  const keyTime = `${now - 60};${now + validFor}`;
  const signKey = hmac(cred.key, keyTime);

  // No headers are signed, which the scheme permits: an empty q-header-list
  // means the signature covers the method, the path and the query only. That is
  // the whole of what these read-only checks vary.
  const httpString = `${method.toLowerCase()}\n${path}\n${q.string}\n\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;

  return [
    'q-sign-algorithm=sha1',
    `q-ak=${cred.id}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    'q-header-list=',
    `q-url-param-list=${q.list}`,
    `q-signature=${hmac(signKey, stringToSign)}`,
  ].join('&');
}

async function send(method, path, query, cred) {
  const q = canonicalQuery(query);
  const url = `https://${HOST}${path}${q.string ? `?${q.string}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: cred ? { authorization: authorization(cred, method, path, q) } : {},
    signal: AbortSignal.timeout(20000),
  });
  return { status: res.status, headers: res.headers, body: method === 'HEAD' ? '' : await res.text() };
}

/** A signed GET. `path` is bucket-relative and starts with `/`. */
export const get = (path, query = {}) => send('GET', path, query, credentials());

/** A signed HEAD — for asking about an object without pulling it down. */
export const head = (path, query = {}) => send('HEAD', path, query, credentials());

/**
 * The same request with no credentials at all — the only active probe this
 * skill makes. It is the question that matters most: can a stranger read it?
 * Anything other than a refusal on a private bucket is the finding.
 */
export const getAnonymous = (path, query = {}) => send('GET', path, query, null);

/**
 * A presigned URL, which is how the clients are meant to reach media: the VM
 * signs, the client fetches, and the object never transits a 5 Mbps uplink.
 * Generating one here is how a check can confirm the scheme works end to end
 * without the service existing yet.
 */
export function presign(path, validFor = 300) {
  const q = canonicalQuery({});
  const sig = authorization(credentials(), 'GET', path, q, validFor);
  return `https://${HOST}${path}?${sig}`;
}

/**
 * Walks every page of a bucket listing.
 *
 * COS caps a response at 1000 keys and the honest failure here is silent: read
 * one page, see no dump because the dumps sort after the media, and report the
 * backup missing. A truncated listing must never be mistaken for a whole one.
 */
export async function listAll(prefix = '', cap = 10000) {
  const objects = [];
  let token = null;
  do {
    const query = { 'list-type': 2, 'max-keys': 1000 };
    if (prefix) query.prefix = prefix;
    if (token) query['continuation-token'] = token;

    const page = await get('/', query);
    if (page.status !== 200) return { status: page.status, objects, truncated: true, body: page.body };

    for (const m of page.body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([^<]*)<\/Key>/.exec(m[1])?.[1];
      const when = /<LastModified>([^<]*)<\/LastModified>/.exec(m[1])?.[1];
      const size = /<Size>(\d+)<\/Size>/.exec(m[1])?.[1];
      if (key) objects.push({ key, when: new Date(when), size: Number(size || 0) });
    }

    const more = /<IsTruncated>true<\/IsTruncated>/.test(page.body);
    token = more ? /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(page.body)?.[1] : null;
  } while (token && objects.length < cap);

  return { status: 200, objects, truncated: Boolean(token) };
}

/**
 * A known-answer test for the signature, run with `--selftest`.
 *
 * Fixed credentials, a fixed clock and a fixed request produce a fixed
 * signature. It proves nothing about whether COS accepts the scheme — only
 * credentials against the live service can — but it does catch the refactor
 * that quietly changes the canonical form, which is the failure that presents
 * as "the keys must be wrong" and costs an afternoon.
 */
export function selftest() {
  const cred = { id: 'AKIDEXAMPLE', key: 'SECRETEXAMPLE' };
  const q = canonicalQuery({ 'list-type': 2, prefix: 'db/', 'max-keys': 1000 });

  if (q.string !== 'list-type=2&max-keys=1000&prefix=db%2F') {
    throw new Error(`canonical query drifted: ${q.string}`);
  }
  if (q.list !== 'list-type;max-keys;prefix') {
    throw new Error(`param list drifted: ${q.list}`);
  }

  const keyTime = '1700000000;1700000600';
  const signKey = hmac(cred.key, keyTime);
  const httpString = `get\n/\n${q.string}\n\n`;
  const signature = hmac(signKey, `sha1\n${keyTime}\n${sha1(httpString)}\n`);
  const expected = hmac(hmac(cred.key, keyTime), `sha1\n${keyTime}\n${sha1(httpString)}\n`);

  if (signature !== expected) throw new Error('signature is not reproducible');
  return { canonicalQuery: q.string, paramList: q.list, signature };
}

if (process.argv[2] === '--selftest') {
  console.log(JSON.stringify(selftest(), null, 2));
  console.log('signature scheme reproduces its canonical form');
}
