/**
 * Time handling — API-CONTRACT.md §1.2.
 *
 * The whole point of this module is that the offset is a **literal, not a
 * conversion**. The database stores naive values, the business timezone is
 * UTC+8, and no layer is allowed to quietly shift anything. §1.2 is explicit:
 * sending `Z` or `+09:00` returns 422 and the server does NOT convert, because
 * converting would turn a teacher's 18:00 deadline into 02:00 the next day.
 */

const OFFSET = '+08:00';

/**
 * Client-submittable scheduled times — the named whitelist from §1.2.
 *
 * Every other `*_at` is an event timestamp: the server sets it and IGNORES a
 * submitted value without erroring (same principle as the derived layer, §7.3).
 *
 * This is a whitelist, not a heuristic. Adding a scheduled-time column upstream
 * means adding it here in the same change.
 *
 * NOTE ON THE COUNT: §1.2's prose says "共 7 列" but the list beneath it holds
 * eight — `db_party_activity.activity_at` was added on 2026-08-20 and the
 * sentence was not updated. The list is the authority. `db_party_activity` is
 * an admin publish form and is not reachable from the teacher client, but it is
 * kept here so this file mirrors the contract exactly.
 */
const SCHEDULED_TIME_COLUMNS = Object.freeze([
  'db_parent_task.start_at',
  'db_parent_task.due_at',
  'db_parent_evaluation.start_at',
  'db_parent_evaluation.due_at',
  'db_task.due_at',
  'db_training.start_at',
  'db_training.end_at',
  'db_party_activity.activity_at',
]);

/** The bare field names, for payload-level checks where the table is implied. */
const SCHEDULED_TIME_FIELDS = Object.freeze(
  Array.from(new Set(SCHEDULED_TIME_COLUMNS.map((c) => c.split('.')[1])))
);

const WIRE_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/;
const WIRE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Format a local wall-clock time for the wire: `YYYY-MM-DDTHH:mm:ss+08:00`.
 *
 * Takes the components as the user picked them. It does not read the device
 * timezone, because the device is not the authority — the kindergarten is. A
 * teacher on a phone set to UTC still means 18:00 园所时间 when they pick 18:00.
 */
function toWireTimestamp({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  return (
    `${year}-${pad(month)}-${pad(day)}` +
    `T${pad(hour)}:${pad(minute)}:${pad(second)}${OFFSET}`
  );
}

/**
 * Compose the wire value from the two strings a `<picker>` gives you:
 * date mode yields `2026-09-01`, time mode yields `18:00`.
 */
function fromPickerParts(dateStr, timeStr = '00:00') {
  if (!WIRE_DATE.test(dateStr)) {
    throw new Error(`date must be YYYY-MM-DD, got: ${dateStr}`);
  }
  const [h, m] = String(timeStr).split(':');
  return `${dateStr}T${pad(h || 0)}:${pad(m || 0)}:00${OFFSET}`;
}

/** Does this string satisfy the wire format the server will accept? */
function isWireTimestamp(value) {
  return typeof value === 'string' && WIRE_AT.test(value);
}

/**
 * Parse a wire timestamp into its wall-clock parts.
 *
 * Returns the components as written, NOT a Date. Building a Date here would
 * re-introduce the device timezone through the back door: `new Date(str)` gives
 * a correct instant, but every subsequent `.getHours()` reads it back in the
 * device's zone, which is exactly the ambiguity §1.2 removes.
 */
function parseWireTimestamp(value) {
  const m = WIRE_AT.exec(value || '');
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6]),
  };
}

/** `2026-08-19T14:03:22+08:00` -> `08-19 14:03`. Display only. */
function formatShort(value) {
  const p = parseWireTimestamp(value);
  if (!p) return value || '';
  return `${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** `2026-08-19T14:03:22+08:00` -> `2026年8月19日 14:03`. Display only. */
function formatLong(value) {
  const p = parseWireTimestamp(value);
  if (!p) return value || '';
  return `${p.year}年${p.month}月${p.day}日 ${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Period keys (`eval_month`, `evaluation_period`, `term_id`) are opaque strings.
 * §1.2: do not parse them as dates. `2026-2027-1` is not a date and
 * `new Date('2026-09')` is a platform-dependent guess.
 */
function isPeriodKey(value) {
  return typeof value === 'string' && /^\d{4}(-\d{2}|-\d{4}-\d)$/.test(value);
}

module.exports = {
  OFFSET,
  SCHEDULED_TIME_COLUMNS,
  SCHEDULED_TIME_FIELDS,
  toWireTimestamp,
  fromPickerParts,
  isWireTimestamp,
  parseWireTimestamp,
  formatShort,
  formatLong,
  isPeriodKey,
};
