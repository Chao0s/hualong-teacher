/**
 * Turns the API contract into routes the mock can serve.
 *
 * The hand-written handlers in server.mjs stay where they are: they encode
 * behaviour the contract's schemas cannot express — cursor fingerprints, the
 * two-stage login, idempotent replay. This module covers the remaining breadth,
 * so that all 90 teacher operations answer instead of 6 of them.
 *
 * What a generated route proves and does not prove:
 *   proves      the path exists, the role gate applies, the success code and the
 *               response SHAPE match the contract
 *   proves not  the business rule, the state machine, the scope predicate
 *
 * That is worth having. A client calling a path the contract does not define is
 * the failure this catches, and it is the failure that already happened four
 * times (see HANDOFF.md → 契约缺口).
 *
 * Loading is lazy and optional: the contract lives in hualong-backend, which is
 * on a different drive since 2026-08-25. When it is absent this returns an empty
 * route table and the hand-written handlers carry on alone, so `npm test` never
 * depends on another repository being mounted.
 */

let cache = null;

/**
 * @returns {{routes: Array, error: string|null}}
 */
export async function loadRoutes() {
  if (cache) return cache;
  try {
    const { loadSpec, operations } = await import('../tools/openapi-source.mjs');
    const spec = loadSpec();
    const rows = operations(spec);
    const routes = rows
      .filter((r) => r.roles.includes('teacher') || r.isPublic)
      .map((r) => buildRoute(r, spec))
      .filter(Boolean);
    cache = { routes, error: null };
  } catch (err) {
    cache = { routes: [], error: err.message };
  }
  return cache;
}

function buildRoute(op, spec) {
  const status = pickSuccessStatus(op);
  if (!status) return null;
  const responses = findOperation(spec, op).responses || {};
  const schema = responses[status]?.content?.['application/json']?.schema || null;
  return {
    method: op.method,
    template: op.path,
    regex: templateToRegex(op.path),
    roles: op.roles,
    isPublic: op.isPublic,
    status: Number(status),
    body: status === '204' ? null : sample(schema, spec, 0),
    operationId: op.operationId,
    blockedOn: op.blockedOn,
  };
}

function findOperation(spec, op) {
  return spec.paths[op.path][op.method.toLowerCase()];
}

/** The lowest 2xx the contract declares. 204 means no body. */
function pickSuccessStatus(op) {
  const codes = op.successCodes.slice().sort();
  return codes[0] || null;
}

/**
 * `/tasks/{task_id}` -> /^\/tasks\/([^/]+)$/
 * Every segment is escaped except the placeholders, so a path containing a dot
 * or a dash cannot widen the match.
 */
function templateToRegex(template) {
  const source = template
    .split('/')
    .map((seg) => (
      /^\{.+\}$/.test(seg) ? '([^/]+)' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ))
    .join('/');
  return new RegExp(`^${source}$`);
}

// ── Sample bodies ──────────────────────────────────────────────────────────

const MAX_DEPTH = 6;

/**
 * Builds one representative value for a schema.
 *
 * `example` wins over `default` wins over `enum[0]` wins over a type default,
 * because a hand-written example is the contract author saying what this looks
 * like, and guessing over the top of that loses information.
 */
function sample(schema, spec, depth) {
  if (!schema || depth > MAX_DEPTH) return null;

  if (schema.$ref) return sample(deref(schema.$ref, spec), spec, depth + 1);
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  if (schema.allOf) {
    return schema.allOf.reduce((acc, part) => {
      const piece = sample(part, spec, depth + 1);
      return piece && typeof piece === 'object' && !Array.isArray(piece)
        ? { ...acc, ...piece }
        : acc;
    }, {});
  }
  // oneOf/anyOf: the first branch. Which branch a real server picks is business
  // logic, and this module deliberately does not simulate business logic.
  if (schema.oneOf) return sample(schema.oneOf[0], spec, depth + 1);
  if (schema.anyOf) return sample(schema.anyOf[0], spec, depth + 1);
  if (schema.enum) return schema.enum[0];

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (type === 'object' || schema.properties) {
    const out = {};
    for (const [key, prop] of Object.entries(schema.properties || {})) {
      out[key] = sample(prop, spec, depth + 1);
    }
    // A cursor envelope with a non-null next_cursor would make a generated
    // route page forever. §3.1: null is the one and only end-of-stream signal.
    if ('next_cursor' in out) out.next_cursor = null;
    return out;
  }

  if (type === 'array') {
    const item = sample(schema.items, spec, depth + 1);
    return item === null ? [] : [item];
  }

  if (type === 'integer' || type === 'number') return 1;
  if (type === 'boolean') return true;
  if (type === 'null') return null;
  return stringSample(schema);
}

// §1.2 — the literal +08:00 offset. Never `Z`, never a converted value.
const WIRE_AT = '2026-09-01T09:00:00+08:00';

/**
 * A string that satisfies the schema, including its `pattern`.
 *
 * Patterns are checked BEFORE formats, because several contract fields carry a
 * pattern and no format. Returning a generic 'sample' for those would emit a
 * value the contract forbids, and a mock that violates the contract teaches the
 * client the wrong thing. `assertSamplesMatchPatterns` in the test suite fails
 * the build if a pattern appears here that this function cannot satisfy.
 */
function stringSample(schema) {
  if (schema.pattern) {
    const p = schema.pattern;
    if (p.includes('T\\d{2}:\\d{2}:\\d{2}\\+08:00')) return WIRE_AT;
    if (p.includes('W\\d{2}')) return '2026-W36';
    if (p === '^\\d{4}-\\d{2}-\\d{2}$') return '2026-09-01';
    if (p === '^\\d{4}-\\d{2}$') return '2026-09';
    if (p.startsWith('^https://')) return 'https://example.invalid/generated';
    return null;   // unsatisfiable here; the test suite reports it by name
  }
  switch (schema.format) {
    case 'date-time': return WIRE_AT;
    case 'date': return '2026-09-01';
    case 'uri':
    case 'url': return 'https://example.invalid/generated';
    case 'uuid': return '00000000-0000-4000-8000-000000000000';
    default: return 'sample';
  }
}

function deref(ref, spec) {
  const parts = ref.replace(/^#\//, '').split('/');
  let node = spec;
  for (const p of parts) {
    node = node?.[p];
    if (node === undefined) return null;
  }
  return node;
}

/** Test hook: drop the memoised table so a changed contract is re-read. */
export function resetCache() {
  cache = null;
}
