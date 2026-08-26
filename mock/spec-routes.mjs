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
    requiredQuery: requiredQuery(op, spec),
    requestBody: requestBodySample(op, spec),
    requiredHeaders: requiredHeaders(op, spec),
    operationId: op.operationId,
    blockedOn: op.blockedOn,
  };
}

/**
 * A request body the contract would accept, built from its own schema.
 *
 * Sending `{}` to every write and calling the resulting 422 "expected" measures
 * nothing: a 422 for a missing NOT NULL column looks exactly like a 422 for a
 * broken endpoint. Generating the declared shape means a refusal afterwards is
 * about the STATE, which is the only interesting kind.
 *
 * The aim is the MINIMAL legal body, not a maximal one. Required scalars are
 * filled; required arrays come back empty, because an empty array satisfies the
 * shape while a generated element has to satisfy rules this function cannot see
 * — a growth-book widget, for instance, must sit inside a 15 × 24 grid without
 * crossing a page. A generated element failed validation where `[]` passes, so
 * the walk was measuring the generator rather than the endpoint.
 *
 * PATCH is excluded by the caller: partial update means an empty body is the
 * most legal body there is.
 *
 * @returns {object|null} null when the operation declares no JSON body
 */
function requestBodySample(op, spec) {
  const raw = findOperation(spec, op).requestBody;
  if (!raw) return null;
  const body = raw.$ref ? deref(raw.$ref, spec) : raw;
  let schema = body?.content?.['application/json']?.schema;
  if (!schema) return null;
  if (schema.$ref) schema = deref(schema.$ref, spec);
  if (!schema) return null;

  const merged = flattenForRequired(schema, spec);
  const props = merged.properties || {};
  const out = {};

  const declared = merged.required || [];

  // PATCH is a partial update: send what the contract REQUIRES and nothing else.
  // Filling the rest asks the server to re-set values it already holds. The
  // required half still matters — `PATCH .../compilation/{id}` requires
  // `revision`, the optimistic-lock token, and omitting it is a 422.
  if (op.method === 'PATCH') {
    for (const key of declared) {
      if (props[key]) out[key] = minimal(props[key], spec);
    }
    return out;
  }

  if (declared.length) {
    for (const key of declared) {
      if (props[key]) out[key] = minimal(props[key], spec);
    }
    return out;
  }

  // Several write schemas declare no `required` at all — `ResourceWrite` and
  // `CaseWrite` among them — while the columns behind them are NOT NULL. The
  // contract under-specifies those writes (recorded in HANDOFF.md). Falling back
  // to "every property the contract types as non-nullable" reconstructs the same
  // set without this file having to know the DDL: a column the contract refuses
  // to type as nullable is one the server is entitled to demand.
  for (const [key, prop] of Object.entries(props)) {
    if (!isNullable(prop)) out[key] = minimal(prop, spec);
  }
  return out;
}

/** A value that satisfies the shape and asserts nothing more. */
function minimal(prop, spec) {
  const resolved = prop && prop.$ref ? deref(prop.$ref, spec) : prop;
  const type = Array.isArray(resolved?.type) ? resolved.type[0] : resolved?.type;
  if (type === 'array') return [];
  return sample(resolved, spec, 0);
}

/** `type: [string, 'null']` is the contract's way of saying a column is nullable. */
function isNullable(prop) {
  if (!prop || !prop.type) return false;
  return Array.isArray(prop.type) ? prop.type.includes('null') : prop.type === 'null';
}

/** allOf composition hides `required` under branches; collect both halves. */
function flattenForRequired(schema, spec, depth = 0) {
  if (depth > MAX_DEPTH) return schema;
  if (schema.$ref) return flattenForRequired(deref(schema.$ref, spec) || {}, spec, depth + 1);
  if (!schema.allOf) return schema;
  return schema.allOf.reduce((acc, part) => {
    const piece = flattenForRequired(part, spec, depth + 1);
    return {
      properties: { ...acc.properties, ...piece.properties },
      required: [...(acc.required || []), ...(piece.required || [])],
    };
  }, { properties: {}, required: [] });
}

/**
 * Headers the contract marks `required` — in practice `Idempotency-Key`.
 *
 * §4 makes the key mandatory on the writes whose replay must not double-execute.
 * Omitting it is a legal refusal, so a walk that omits it is testing its own
 * omission rather than the endpoint.
 */
function requiredHeaders(op, spec) {
  const item = spec.paths[op.path];
  const declared = [...(item.parameters || []), ...(findOperation(spec, op).parameters || [])];
  const names = [];
  for (const p of declared) {
    const param = p.$ref ? deref(p.$ref, spec) : p;
    if (param && param.in === 'header' && param.required) names.push(param.name);
  }
  return names;
}

/**
 * The query parameters the contract marks `required`, with one legal value each.
 *
 * A generated route does not validate query parameters, but a hand-written one
 * may — `GET /coordination/documents` refuses without `coord_category`, because
 * the contract says the domain is fixed and an unknown value is a 400. Callers
 * that walk every operation need this to build a request the contract would
 * actually accept, instead of one it is entitled to refuse.
 */
function requiredQuery(op, spec) {
  const item = spec.paths[op.path];
  const declared = [...(item.parameters || []), ...(findOperation(spec, op).parameters || [])];
  const out = {};
  for (const raw of declared) {
    const param = raw.$ref ? deref(raw.$ref, spec) : raw;
    if (!param || param.in !== 'query' || !param.required) continue;
    const schema = param.schema && param.schema.$ref
      ? deref(param.schema.$ref, spec)
      : (param.schema || {});
    out[param.name] = sample(schema, spec, 0);
  }
  return out;
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
