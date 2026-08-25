/**
 * 首页服务 — the four regions of flowchart 01, assembled once (ticket 08).
 *
 * PROVISIONAL, and named for a page rather than a contract module — which
 * 实现决定 6 forbids, for the good reason that pages get reorganised by design
 * review and contract modules do not. It is here because there is nothing to
 * align to yet: `API-MODULES.md` enumerates 身份与组织 / 在园时光 / 家园社共育 /
 * 成长册 and no 首页, and `openapi.yaml` has no `/home/*` path at all (tracker
 * DECISIONS item 9). When the read surface is registered, 待办事项 belongs to
 * whichever module owns db_task, and this file should shrink to the 常用入口 map
 * or disappear. **Do not read this file as a licence to write one service per
 * page.**
 *
 * What it does own today: the 待办事项 read and the 常用入口 map. 资源中心通知 and
 * 推荐课程案例 are NOT re-read here — they belong to the notice and case modules
 * and are delegated, so 首页 can never disagree with 通知列表页 or 案例库.
 *
 * Everything returned is view-ready (实现决定 7). Every enum below is mapped
 * with a fallback: §1.1 lets the server add a code before this client knows it,
 * and an unknown code must degrade to something neutral rather than blank the
 * region or throw.
 */

const api = require('../utils/request');
const guard = require('../utils/guard');
const time = require('../utils/time');
const notice = require('./notice');
// `case` is a reserved word; the module is named for what it holds, the binding
// for what JavaScript allows.
const kase = require('./case');

const TODOS_PATH = '/home/todos';

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

/**
 * 常用入口 (flowchart 01). `module` is checked against the role allowlist before
 * navigation; `page` stays null until that screen exists, and a tap on a null
 * page is refused out loud rather than dead-ending. `needsTerm` marks the write
 * entries the holiday disables.
 *
 * `icon` and `color` name the drawing and its tint (ticket 09). No path here or
 * in the markup — hl-icon resolves it.
 *
 * Three entries gained a destination when the bottom bar landed: they reach
 * their module's entry page, which then lists the screen itself. Two hops, both
 * honest. 课程资源 has no tab of its own — 资源库 is the sixth module and the bar
 * holds five (DO-NOT-BUILD 14) — so this quick entry IS its only door from 首页
 * (ticket 13), and it lands on the same 课程资源 page 教研培训 reaches.
 */
const QUICK_ENTRIES = [
  { key: 'training', label: '教研培训', module: 'teaching-research', page: '/pages/training/index', needsTerm: false, icon: 'icon-16', color: 'accent' },
  { key: 'moment', label: '在园时光', module: 'co-education', page: '/pages/co-education/index', needsTerm: true, icon: 'icon-17', color: 'green' },
  { key: 'month-eval', label: '月度评价', module: 'co-education', page: '/pages/co-education/index', needsTerm: true, icon: 'icon-18', color: 'amber' },
  { key: 'resource', label: '课程资源', module: 'resource-library', page: '/packages/library/pages/home/index', needsTerm: false, icon: 'icon-19', color: 'blue' },
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
 * The whole screen in one call. Three independent reads, settled together so a
 * slow region does not hold the others back.
 *
 * Any one failing fails the load, deliberately: a 首页 quietly missing a region
 * is worse than a 首页 that says it could not read. The markup holds up its end
 * — while `errorText` is set no region claims 暂无, so a failure never reads as
 * "nothing to do today".
 *
 * Only two of the three reads are ours. 通知 belongs to the notice module and
 * 案例 to the case module; this function composes them, it does not re-read them.
 */
async function load() {
  const [todos, notices, cases] = await Promise.all([
    loadTodos(),
    notice.summary(),
    kase.recommendedForHome(),
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
    icon: entry.icon,
    color: entry.color,
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

/** A 待办事项 card leads to 任务进度看板 (ticket 10). */
function openTodo() {
  guard.navigateTo('/pages/task/board', 'home');
}

module.exports = {
  load,
  quickEntries,
  openQuickEntry,
  openCase,
  openTodo,
};
