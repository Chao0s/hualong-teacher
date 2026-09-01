/**
 * Locates and loads the API contract, which lives in a DIFFERENT repository.
 *
 * `api/openapi.yaml` belongs to hualong-backend and is the machine-readable
 * truth for 125 paths / 150 operations. This repo reads it; it never copies it.
 * A copy would go stale silently, and a stale contract is worse than none.
 *
 * The two repos are siblings: `D:\hualong-teacher` and `D:\hualong-backend`.
 *
 * The Google Drive path used to sit in the candidate list below it, as a
 * fallback. It was removed on 2026-09-01, and the removal is the whole point:
 * for a while BOTH existed, the sibling won, and the sibling was two commits
 * behind — so `spec:inventory` reported the v0.6 counts and `npm run docs:api`
 * generated a v0.6 Swagger site, silently. A fallback to a second copy of the
 * contract is not resilience; it is the stale-copy failure this file's second
 * paragraph warns about, wearing a different hat. **One copy, or fail loudly.**
 *
 * Override with HUALONG_OPENAPI=<absolute path>.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const CANDIDATES = [
  process.env.HUALONG_OPENAPI,
  resolve(REPO, '..', 'hualong-backend', 'api', 'openapi.yaml'),
].filter(Boolean);

/** @returns {string} absolute path to the contract */
export function specPath() {
  for (const c of CANDIDATES) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `找不到 openapi.yaml。已尝试：\n  ${CANDIDATES.join('\n  ')}\n` +
    '设置 HUALONG_OPENAPI=<绝对路径> 指向 hualong-backend/api/openapi.yaml。',
  );
}

export function specText() {
  return readFileSync(specPath(), 'utf8');
}

export function loadSpec() {
  return yaml.load(specText());
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/**
 * Flattens the contract into one row per operation.
 *
 * `x-hualong-roles` is the authorization truth. `x-hualong-action` may carry a
 * `|`-separated list, because one endpoint can legally produce more than one
 * to_state (save-draft vs publish are two exits of the same dialog), so the
 * registry has several rows where the contract has one path.
 *
 * @returns {Array<{
 *   method: string, path: string, operationId: string|null, tags: string[],
 *   roles: string[], actions: string[], permission: string|null,
 *   blockedOn: string[], successCodes: string[], allCodes: string[],
 *   hasPathParams: boolean, summary: string|null
 * }>}
 */
export function operations(spec = loadSpec()) {
  const rows = [];
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const codes = Object.keys(op.responses || {});
      rows.push({
        method: method.toUpperCase(),
        path,
        operationId: op.operationId || null,
        tags: op.tags || [],
        roles: splitList(op['x-hualong-roles']),
        actions: splitList(op['x-hualong-action']),
        permission: op['x-hualong-permission'] || null,
        blockedOn: splitList(op['x-hualong-blocked-on']),
        successCodes: codes.filter((c) => /^2\d\d$/.test(c)),
        allCodes: codes,
        hasPathParams: path.includes('{'),
        summary: op.summary || null,
        // `security: []` overrides the document default and marks the operation
        // as pre-session. Only the login endpoint carries it, and it is exactly
        // why that one operation has no x-hualong-roles: there is no role yet.
        isPublic: Array.isArray(op.security) && op.security.length === 0,
      });
    }
  }
  return rows;
}

/** Accepts a string, a `|`-separated string, an array, or nothing. */
function splitList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(String);
  return String(value).split('|').map((s) => s.trim()).filter(Boolean);
}

/**
 * Operations this client may call: role-gated teacher operations plus the
 * pre-session login. Role names come from db/spec/scope-rules.json.
 */
export function teacherOperations(rows = operations()) {
  return rows.filter((r) => r.roles.includes('teacher') || r.isPublic);
}
