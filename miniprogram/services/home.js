/**
 * 首页服务 — the four regions of flowchart 01, assembled once (ticket 08).
 *
 * Boundary: the home aggregate reads (待办事项, 推荐课程案例) plus the 常用入口
 * map. 资源中心通知 is NOT re-read here — it belongs to the notice module and is
 * delegated to it, so 首页 and 通知列表页 share one implementation.
 *
 * Everything returned is view-ready (spec 实现决定 7). Every enum below is
 * mapped with a fallback: §1.1 lets the server add a code before this client
 * knows it, and an unknown code must degrade to something neutral rather than
 * blank the region or throw.
 */

const api = require('../utils/request');
const guard = require('../utils/guard');
const time = require('../utils/time');
const notice = require('./notice');

const TODOS_PATH = '/home/todos';
const CASES_PATH = '/home/cases';

const TODO_PILL = {
  upload: 'hl-pill--info',
  task: 'hl-pill--pending',
  audit: 'hl-pill--danger',
  evaluation: 'hl-pill--ok',
};

const TODO_LABEL = {
  upload: '待上传',
  task: '待完成',
  audit: '待审核',
  evaluation: '待填写',
};

// db_case.case_field / case_grade.
const CASE_FIELD = { f1: '健康', f2: '语言', f3: '社会', f4: '科学', f5: '艺术' };
const CASE_GRADE = { k1: '小班', k2: '中班', k3: '大班' };

/**
 * 常用入口 (flowchart 01). `module` is checked against the role allowlist before
 * navigation; `page` stays null until that screen exists, and a tap on a null
 * page is refused out loud rather than dead-ending. `needsTerm` marks the write
 * entries the holiday disables.
 */
const QUICK_ENTRIES = [
  { key: 'training', label: '教研培训', module: 'teaching-research', page: null, needsTerm: false },
  { key: 'moment', label: '在园时光', module: 'co-education', page: null, needsTerm: true },
  { key: 'month-eval', label: '月度评价', module: 'co-education', page: null, needsTerm: true },
  { key: 'resource', label: '课程资源', module: 'resource-library', page: null, needsTerm: false },
];

/**
 * 待办事项 (§3.5 roster-shaped): bounded by one teacher's workload and meant to
 * be read whole, so it does not paginate.
 */
async function loadTodos() {
  const rows = await api.getRoster(TODOS_PATH);
  return rows.map((row) => ({
    ...row,
    due_label: row.due_at ? time.formatShort(row.due_at) : '',
    pill_class: TODO_PILL[row.todo_kind] || 'hl-pill--unknown',
    kind_label: TODO_LABEL[row.todo_kind] || '待办',
  }));
}

/**
 * 推荐课程案例 (§3.5): db_home_case, the shelf an administrator curates in the
 * PC backend. Three rows by definition, so no pagination. Scoping it to 化龙
 * teachers is the server's job — filtering an authorization rule a second time
 * here would only hide a server bug (§6.4).
 */
async function loadCases() {
  const rows = await api.getRoster(CASES_PATH);
  return rows.map((row) => {
    const field = CASE_FIELD[row.case_field] || '';
    const grade = CASE_GRADE[row.case_grade] || '';
    return {
      case_id: row.case_id,
      case_name: row.case_name,
      // An unknown field code loses its initial, not its card.
      thumb_label: field ? field.charAt(0) : '案',
      tag_label: [field, grade].filter(Boolean).join(' · '),
    };
  });
}

/**
 * The whole screen in one call. Three independent reads, settled together so a
 * slow region does not hold the others back; any one failing fails the load,
 * because a 首页 missing a region silently is worse than a 首页 that says so.
 */
async function load() {
  const [todos, notices, cases] = await Promise.all([
    loadTodos(),
    notice.summary(),
    loadCases(),
  ]);
  // Story 11: the count is the point — a teacher must see the backlog without
  // opening it.
  return { todos, todoCount: todos.length, notices, cases };
}

/** 常用入口, ready to bind. `disabled` is the holiday's visible half. */
function quickEntries(canWrite) {
  return QUICK_ENTRIES.map((entry) => ({
    key: entry.key,
    label: entry.label,
    disabled: Boolean(entry.needsTerm && !canWrite),
  }));
}

/**
 * Act on a 常用入口 tap. Three outcomes, and none of them is silence:
 * blocked by the holiday, blocked because the screen is not built yet, or a
 * role-checked navigation.
 */
function openQuickEntry(key, canWrite) {
  const entry = QUICK_ENTRIES.find((q) => q.key === key);
  if (!entry) return;
  if (entry.needsTerm && !canWrite) {
    wx.showToast({ title: '假期中暂不可发布，新学期开始后恢复', icon: 'none' });
    return;
  }
  if (!entry.page) {
    wx.showToast({ title: '该模块尚未上线', icon: 'none' });
    return;
  }
  guard.navigateTo(entry.page, entry.module);
}

/**
 * Every path into 案例库 — a recommended card and the 全部 link both — lands
 * here. The module has no screens in this slice, so the honest answer is the
 * only answer; ticket 11 replaces the body with a navigation.
 */
function openCase() {
  wx.showToast({ title: '案例库尚未上线', icon: 'none' });
}

/**
 * A 待办事项 card leads to 任务进度看板, which ticket 10 builds. Until then it
 * says so: every region on 首页 that looks tappable either navigates or gives a
 * reason, and none of them absorbs a tap in silence.
 */
function openTodo() {
  wx.showToast({ title: '待办事项看板尚未上线', icon: 'none' });
}

module.exports = {
  load,
  quickEntries,
  openQuickEntry,
  openCase,
  openTodo,
};
