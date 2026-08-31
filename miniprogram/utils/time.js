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

/**
 * `2026-08-19T14:03:22+08:00` -> `08-19`. Display only.
 *
 * 入口页的卡片一行里要塞下类型、日期与部门，钟点在那里既放不下也没有用。它与
 * `formatShort` 读的是同一份写好的部分，同样不建 Date。
 */
function formatDay(value) {
  const p = parseWireTimestamp(value);
  if (!p) return value || '';
  return `${pad(p.month)}-${pad(p.day)}`;
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

/**
 * 园所当前月份的期间键，`YYYY-MM`（月度评价用它，票据 20）。
 *
 * ── 读的是时刻，不是设备时区 ─────────────────────────────────────────────────
 *
 * 这个模块头注写着「设备不是权威，幼儿园才是」，而这一条并不违反它：
 *
 *   `nowMs` 是一个**时刻**（UTC 毫秒），它与时区无关 —— 一部时区设成 UTC 的手机与一部
 *   设成 UTC+8 的手机，在同一秒读到的 `Date.now()` 完全相同。
 *   `+8` 是**字面偏移量**，与 `OFFSET` 是同一个常数，不是一次换算 —— 园所在 UTC+8，
 *   中国不实行夏令时，所以「园所墙上的钟」＝ 时刻加 8 小时后的 UTC 读数。
 *
 * **全程整数算术，一个 `Date` 也不建。** 这不是洁癖：`new Date(ms)` 之后每一次
 * `.getMonth()` 都按运行这台机器的时区读回来，而那正是 §1.2 要消掉的歧义。9 月 1 日
 * 07:00 园所时间，一部时区设成 UTC 的手机上 `getMonth()` 读到的是 8 月 —— 教师会看到
 * 上个月，而且不会有任何报错。所以这里自己把「1970 以来的第几天」换成年月。
 *
 * **不解析期间键，只生成它。** 生成出来的字符串之后一律当不透明串传递（§1.2）。
 *
 * **`nowMs` 必填，本模块不读时钟。** 这个模块从头到尾是纯算术：不读设备时区，也不读设备
 * 时钟。读时钟的那一句在 `services/evaluation.currentMonth` 里，只有一处，而且页面可以
 * 注入它 —— 不可注入就测不了跨月。
 *
 * @param {number} nowMs 时刻（UTC 毫秒）。与时区无关，所以它是一个数不是一个日期。
 */
function currentMonthKey(nowMs) {
  if (typeof nowMs !== 'number' || Number.isNaN(nowMs)) {
    throw new Error('currentMonthKey 需要一个时刻（UTC 毫秒）。本模块不读时钟。');
  }
  const civil = civilFromDays(Math.floor((nowMs + 8 * 3600 * 1000) / 86400000));
  return `${civil.year}-${pad(civil.month)}`;
}

/**
 * 「1970-01-01 以来的第几天」换成公历年月日，纯整数。
 *
 * Howard Hinnant 的 `civil_from_days`：把纪元挪到 3 月 1 日，闰日因此落在一年的末尾，
 * 400 年一个周期（146097 天）里没有例外要特判。逐行照抄那份算法，不改一个常数 ——
 * 它的正确性不靠这里再论证一遍，而这个模块也确实不该有第二种日期算法。
 */
function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;                                  // 0..146096
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );                                                             // 0..399
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);                    // 0..11，3 月为 0
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;          // 1..31
  const month = mp + (mp < 10 ? 3 : -9);                         // 1..12
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
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
  formatDay,
  formatLong,
  isPeriodKey,
  currentMonthKey,
};
