/**
 * 案例服务 — everything that knows what a `db_case` row means (ticket 08).
 *
 * Boundary: the case-library module. 首页's 推荐课程案例 shelf is the first and
 * so far only reader, and it is deliberately NOT served from services/home.js:
 * `case_field` and `case_grade` are case columns, and the module that owns a
 * column owns its display mapping. 案例库 (ticket 13) extends this file rather
 * than copying the two tables — the same rule that keeps 首页's notice summary
 * and 通知列表页 on one implementation.
 *
 * Nothing here ranks or personalises. The shelf is an ordered list an
 * administrator curated in the PC backend; this module renders it in the order
 * it arrives (ADR-0011, DO-NOT-BUILD 13's neighbour, item 6).
 */

const api = require('../utils/request');

// db_case.case_field / db_case.case_grade. §1.1: the server may add a code
// before this build knows it, so every lookup has a fallback.
const CASE_FIELD = { f1: '健康', f2: '语言', f3: '社会', f4: '科学', f5: '艺术' };
const CASE_GRADE = { k1: '小班', k2: '中班', k3: '大班' };

// db_home_case, the curated shelf. Three rows by definition, so §3.5 whole-read
// rather than a cursor. The path is provisional: the contract has no teacher
// read surface yet (tracker DECISIONS item 9).
const HOME_SHELF_PATH = '/home/cases';

/** One card, ready to bind. */
function decorateCard(row) {
  const field = CASE_FIELD[row.case_field] || '';
  const grade = CASE_GRADE[row.case_grade] || '';
  return {
    case_id: row.case_id,
    case_name: row.case_name,
    // An unknown field code loses its initial, not its card.
    thumb_label: field ? field.charAt(0) : '案',
    tag_label: [field, grade].filter(Boolean).join(' · '),
  };
}

/** 首页's 推荐课程案例 shelf. */
async function recommendedForHome() {
  const rows = await api.getRoster(HOME_SHELF_PATH);
  return rows.map(decorateCard);
}

module.exports = {
  decorateCard,
  recommendedForHome,
};
