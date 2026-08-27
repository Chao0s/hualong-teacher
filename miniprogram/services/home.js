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
 * What it does own today: the 待办事项 aggregate read (three stat cards plus
 * the 通知 unread badge) and the 常用入口 map. 推荐课程案例 is NOT re-read here —
 * it belongs to the case module and is delegated, so 首页 can never disagree
 * with 案例库. 通知 rows are not read here at all since the 2026-08-26
 * redesign; the entry card leads to 通知列表页, which owns them.
 *
 * Everything returned is view-ready (实现决定 7). Every enum below is mapped
 * with a fallback: §1.1 lets the server add a code before this client knows it,
 * and an unknown code must degrade to something neutral rather than blank the
 * region or throw.
 */

const api = require('../utils/request');
const guard = require('../utils/guard');
// `case` is a reserved word; the module is named for what it holds, the binding
// for what JavaScript allows.
const kase = require('./case');
const library = require('./library');
const quality = require('./quality');

const TODOS_PATH = '/home/todos';

// 传 card badge: the latest upload record's status (db_upload_action, 01
// home-spec.md). No record yet — and, per §1.1, a status code this build does
// not know — both degrade to the prototype's own call-to-action copy, never
// the raw code.
const UPLOAD_BADGE = {
  s1: '草稿',
  s2: '待审核',
  s3: '已通过',
  s4: '已驳回',
};
const UPLOAD_BADGE_FALLBACK = '提交审核';

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
// 通知 holds the first slot since the 2026-08-26 redesign: 教研培训 was the one
// card that duplicated a bottom-bar tab, and 通知 had no entry at all. Four
// cards before, four after.
const QUICK_ENTRIES = [
  { key: 'notice', label: '通知', module: 'home', page: '/pages/notice/list', needsTerm: false, icon: 'icon-20', color: 'accent' },
  { key: 'moment', label: '在园时光', module: 'co-education', page: '/pages/co-education/index', needsTerm: true, icon: 'icon-17', color: 'green' },
  { key: 'month-eval', label: '月度评价', module: 'co-education', page: '/pages/co-education/index', needsTerm: true, icon: 'icon-18', color: 'amber' },
  { key: 'resource', label: '课程资源', module: 'resource-library', page: '/packages/library/pages/home/index', needsTerm: false, icon: 'icon-19', color: 'blue' },
];

/**
 * 待办事项 as the prototype draws it: three stat cards (传／办／评), each a
 * mark, a title and a badge, from the db_home aggregate (01 home-spec.md,
 * persist=0). View-ready — the page binds, it never formats.
 *
 * The badge rules are the spec's own: 办 shows 待处理 N and shows it at N=0
 * too (spec line 90); 评 shows numerator/denominator
 * (ui=home.todo.assessment.badge.*); 传 maps the latest upload status.
 */
async function loadStats() {
  const agg = await api.get(TODOS_PATH);
  return {
    stats: [
      {
        key: 'upload',
        mark: '传',
        title: '上传资源',
        badge: UPLOAD_BADGE[agg.upload_status] || UPLOAD_BADGE_FALLBACK,
        badge_class: '',
      },
      {
        key: 'task',
        mark: '办',
        title: '待办任务',
        badge: `待处理 ${agg.pending_task_count}`,
        badge_class: 'stat__badge--warn',
      },
      {
        key: 'assessment',
        mark: '评',
        title: '质量评估',
        // 分母是**办园质量评估那件工具的题数**（120），不是班上的幼儿数。
        // 01 home-spec.md 的 `home.todo.assessment.badge.denominator` 指的是
        // `db_assessment.required_count`，而那是 `school-quality-120@1.0.0` 的题项数。
        // 2026-08-27 之前这里数的是幼儿，因为那张卡被接到了五大领域量表 —— 两件不同
        // 的量具，见 services/quality.js 的头注。
        badge: `${agg.assessment_completed_count}/${agg.assessment_required_count}`,
        badge_class: 'stat__badge--info',
      },
    ],
    unreadNotice: agg.unread_notice_count || 0,
    // 那张卡是**带着既有 assessment_id 跳转的**（契约原话）。没有编号就没得跳 ——
    // 契约里没有创建端点，客户端不替谁开一份。
    assessmentId: agg.assessment_id || 0,
  };
}

/**
 * The whole screen in one call. Two independent reads, settled together so a
 * slow region does not hold the other back.
 *
 * Either failing fails the load, deliberately: a 首页 quietly missing a region
 * is worse than a 首页 that says it could not read. The markup holds up its end
 * — while `errorText` is set no region claims 暂无, so a failure never reads as
 * "nothing to do today".
 *
 * 案例 belongs to the case module; this function composes it, it does not
 * re-read it. 通知 is no longer read here at all — the quick entry's unread
 * badge rides on the db_home aggregate, and the rows live on 通知列表页.
 */
async function load() {
  const [{ stats, unreadNotice, assessmentId }, cases] = await Promise.all([
    loadStats(),
    kase.recommendedForHome(),
  ]);
  return { stats, unreadNotice, assessmentId, cases };
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
 * 推荐课程案例卡片 -> 案例详情（票据 13）。
 *
 * 首页只知道「点了哪一条」，不知道案例详情在哪个分包的哪一页 —— 那件事 services/
 * library.js 说了算，这里转交。所以首页与资源详情的关联案例进的是**同一个**案例详情
 * 页，而不是两处各写一条路径然后慢慢分叉。
 *
 * 票据 08 的交接特意让卡片先不带 id，等的就是这一轮：现在 wxml 上有 `data-id`，
 * 这里收下它。
 */
function openCase(caseId) {
  library.openCase(caseId);
}

/** 「全部案例」 -> 案例列表。与单张卡片是两个去向，所以是两个函数。 */
function openCaseList() {
  library.open('case');
}

/**
 * A 待办事项 stat card leads to its own surface: 传 opens the upload form
 * (ticket 15 — same form, same service write path as the 案例库 entry, and
 * **不带目标类型**：没有一列说得出这条待办是资源还是案例，替它猜一个，教师十次里
 * 有五次要改回来)；评 opens 办园质量评估, which is what `01 home-spec.md` has
 * always meant by that card；办 and anything unknown lead to 任务进度看板
 * (ticket 10) — the neutral destination.
 */
function openTodo(kind, assessmentId) {
  if (kind === 'upload') {
    library.openUpload();
    return;
  }
  if (kind === 'assessment') {
    // 办园质量评估，不是五大领域量表 —— 两件不同的量具，见 services/quality.js 的
    // 头注。2026-08-27 之前这里接的是量表，那是这张卡从没建成过它自己那一页时的
    // 权宜，卡上写着「质量评估」却打开评一名幼儿的表。
    quality.open(assessmentId);
    return;
  }
  guard.navigateTo('/pages/task/board', 'home');
}

module.exports = {
  load,
  quickEntries,
  openQuickEntry,
  openCase,
  openCaseList,
  openTodo,
};
