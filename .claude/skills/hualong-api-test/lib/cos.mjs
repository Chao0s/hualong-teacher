/**
 * Tencent COS v5 request signing, implemented here so nothing has to be
 * installed — not on this machine, not on the VM. `coscli` and `tccli` are both
 * absent from the server, and putting a credentialed CLI profile on the host
 * that stores every child's photograph is a worse trade than 40 lines of HMAC.
 *
 * The algorithm is Tencent's `q-sign-algorithm=sha1` scheme:
 *   SignKey      = HMAC-SHA1(SecretKey, KeyTime)
 *   HttpString   = method \n path \n query \n headers \n
 *   StringToSign = "sha1" \n KeyTime \n SHA1(HttpString) \n
 *   Signature    = HMAC-SHA1(SignKey, StringToSign)
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

export function credentials() {
  const id = process.env.COS_SECRET_ID;
  const key = process.env.COS_SECRET_KEY;
  if (!id || !key) {
    throw new Error('COS_SECRET_ID and COS_SECRET_KEY must be set in the environment. ' +
      'Set them in your own shell; never in a file this repository can see.');
  }
  return { id, key };
}

function sign({ id, key }, method, path, query = {}) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 600}`;
  const signKey = hmac(key, keyTime);

  const params = Object.keys(query).sort();
  const queryString = params.map((k) => `${k.toLowerCase()}=${encodeURIComponent(query[k])}`).join('&');

  const httpString = `${method.toLowerCase()}\n${path}\n${queryString}\n\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;

  return [
    'q-sign-algorithm=sha1',
    `q-ak=${id}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    'q-header-list=',
    `q-url-param-list=${params.map((p) => p.toLowerCase()).join(';')}`,
    `q-signature=${hmac(signKey, stringToSign)}`,
  ].join('&');
}

/** A signed GET. `path` is bucket-relative and starts with `/`. */
export async function get(path, query = {}) {
  const qs = Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`https://${HOST}${path}${qs ? `?${qs}` : ''}`, {
    headers: { authorization: sign(credentials(), 'GET', path, query) },
  });
  return { status: res.status, body: await res.text() };
}

/**
 * The same GET with no credentials at all — the only active probe this skill
 * makes. It is the question that matters most: can a stranger read it? Anything
 * other than 403 on a private bucket is the finding.
 */
export async function getAnonymous(path) {
  const res = await fetch(`https://${HOST}${path}`);
  return { status: res.status, body: (await res.text()).slice(0, 400) };
}
