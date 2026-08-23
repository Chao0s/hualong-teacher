/**
 * The derived / scoped / free tiers — API-CONTRACT.md §7.3 and §7.3.1.
 *
 * Transcribed from hualong-backend `db/spec/scope-rules.json`, roles.teacher.
 * That file is the authority; if the two disagree, this file is wrong.
 *
 * Why the client strips derived keys instead of just letting the server ignore
 * them: §7.3 says the server silently ignores them, and §7.3 (ordering, added
 * in v0.5) says the request-validation middleware strips derived keys BEFORE
 * schema validation, because `additionalProperties: false` would otherwise 422
 * a request the tier rules say should be accepted. A client that sends them is
 * relying on that ordering being implemented correctly. Not sending them is
 * free and removes the dependency.
 *
 * The reason this matters beyond tidiness is §7.3.1: `teacher_id` moved from
 * `scoped` to `derived` on 2026-08-20 precisely because scoped semantics
 * ("client may supply, server re-verifies it is in range") cannot protect an
 * author column — a colleague's `teacher_id` in the same class passes the range
 * check by definition, so authorship was forgeable.
 */

// Server sets these from the login context. The client must never send them.
const DERIVED = Object.freeze([
  'school_id',
  'class_id',
  'created_by',
  'uploaded_by',
  'requested_by_teacher_id',
  'teacher_id',
]);

// The teacher chooses these, and the server re-verifies each one inside the
// same predicate as the write — never read-then-write. Send them.
const SCOPED = Object.freeze([
  'child_id',
  'term_id',
  'compilation_id',
  'topic_id',
  'parent_task_id',
  'section_id',
]);

// Empty for the teacher surface. Cross-teacher querying is an admin function.
const FREE = Object.freeze([]);

// Event timestamps are the other silently-ignored family (§1.2). Listing them
// here keeps one strip pass instead of two.
const EVENT_TIMESTAMPS = Object.freeze([
  'created_at', 'submitted_at', 'published_at', 'reviewed_at', 'uploaded_at',
  'locked_at', 'applied_at', 'accepted_at', 'completed_at', 'cancelled_at',
  'registered_at', 'consented_at', 'revoked_at', 'started_at', 'finished_at',
]);

const STRIP = new Set([...DERIVED, ...EVENT_TIMESTAMPS]);

/**
 * Remove keys the server would ignore anyway.
 *
 * Shallow by design: the contract's tiers are defined over columns of the target
 * table, and nested objects on the wire are either separate resources with their
 * own tier rules or opaque blobs (`permission_scope`). Recursing would strip a
 * legitimate `class_id` out of, say, a filter object.
 *
 * Returns `{ body, stripped }` so callers can surface a developer warning in
 * the mock environment rather than silently swallowing a bug.
 */
function stripDerived(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { body, stripped: [] };
  }
  const out = {};
  const stripped = [];
  Object.keys(body).forEach((key) => {
    if (STRIP.has(key)) {
      stripped.push(key);
      return;
    }
    out[key] = body[key];
  });
  return { body: out, stripped };
}

function isDerived(key) {
  return DERIVED.indexOf(key) !== -1;
}

function isScoped(key) {
  return SCOPED.indexOf(key) !== -1;
}

module.exports = {
  DERIVED,
  SCOPED,
  FREE,
  EVENT_TIMESTAMPS,
  stripDerived,
  isDerived,
  isScoped,
};
