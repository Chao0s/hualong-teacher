/**
 * Locates and loads the API contract, which lives in a DIFFERENT repository.
 *
 * `api/openapi.yaml` belongs to hualong-backend and is the machine-readable
 * truth for 126 paths / 149 operations. This repo reads it; it never copies it.
 * A copy would go stale silently, and a stale contract is worse than none.
 *
 * The path is not a simple `../hualong-backend` any more: this repo moved to
 * D:\hualong-teacher on 2026-08-25 while the backend stayed on the Google Drive
 * virtual disk, so the two are no longer siblings. Hence the candidate list.
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
  'G:/My Drive/Personal Materials/App Dev/Hualong/hualong-backend/api/openapi.yaml',
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
