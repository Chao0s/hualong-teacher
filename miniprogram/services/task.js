/**
 * 共建任务服务 — the task module's reads (ticket 10).
 *
 * Read-only by design. Accepting a task, completing it and submitting material
 * are writes with their own gate path and their own test shape (ticket 11), so
 * nothing here posts, and no page this service feeds carries a write control.
 *
 * TWO STATUS COLUMNS, AND THEY ARE NOT THE SAME THING:
 *   db_task.task_status         t1 待接收 | t2 进行中 | t3 已完成 | t4 已取消
 *   db_task_assign.assign_status a1 待接收 | a2 进行中 | a3 已完成
 * The first is the task's own life; the second is THIS teacher's part in it.
 * A board row shows the teacher's own state, because "what do I still owe" is
 * the question the screen answers. The task's state matters only where it
 * overrides the teacher's — a cancelled task is closed no matter what the
 * teacher's row says.
 *
 * §7.3: `assign` is the caller's own row. The server derives it; there is no
 * way to ask for a colleague's, and this module never tries.
 *
 * Every label has a fallback. §1.1 lets the server ship a status code before
 * this build knows it, and an unknown code must still render a row.
 */

const api = require('../utils/request');
const time = require('../utils/time');

const PATH = '/tasks';

const ASSIGN_LABEL = { a1: '待接收', a2: '进行中', a3: '已完成' };
const ASSIGN_PILL = { a1: 'hl-pill--pending', a2: 'hl-pill--info', a3: 'hl-pill--ok' };

const TASK_LABEL = { t1: '待接收', t2: '进行中', t3: '已完成', t4: '已取消' };

// The task states in which nothing more can be submitted, whatever this
// teacher's own row says.
const CLOSED_TASK_STATUS = ['t3', 't4'];

const CREATOR_LABEL = { c1: '教师发起', c2: '管理端发起' };

/** One board row, ready to bind. */
function decorateRow(task) {
  const assign = task.assign || {};
  return {
    task_id: task.task_id,
    task_title: task.task_title,
    task_intro: task.task_intro,
    // §1.2: the offset is a literal. formatShort reads the written parts and
    // never builds a Date, so nothing here can shift a 18:00 deadline.
    due_label: time.formatShort(task.due_at),
    status_label: ASSIGN_LABEL[assign.assign_status] || '进行中',
    status_class: ASSIGN_PILL[assign.assign_status] || 'hl-pill--unknown',
    creator_label: CREATOR_LABEL[task.creator_type] || '',
    // 已取消 is the task's business, not the teacher's, so it is shown apart
    // from the status pill rather than overwriting it.
    closed_note: task.task_status === 't4' ? '任务已取消' : '',
  };
}

/**
 * One page of the board (§3.1).
 *
 * `scope` is a real filter, so a cursor issued under one scope is not valid
 * under another — §3.3 makes that a 400 rather than a silently wrong answer,
 * and utils/list-page reloads from the top when it sees one.
 */
async function listPage({ cursor, limit, scope } = {}) {
  const page = await api.getPage(PATH, { cursor, limit, scope });
  return { items: page.items.map(decorateRow), nextCursor: page.nextCursor };
}

/**
 * One task, whole, with this teacher's own assignment.
 *
 * `progress` comes from the server, computed from the assign rows. The
 * prototype hard-coded 52/12/6; the contract forbids reusing those numbers, so
 * this passes through what the server counted and never derives its own.
 */
async function detail(taskId) {
  const task = await api.get(`${PATH}/${taskId}`);
  const assign = task.assign || {};
  const progress = task.progress || {};
  return {
    task_id: task.task_id,
    task_title: task.task_title,
    task_intro: task.task_intro,
    task_division: task.task_division,
    due_label: time.formatLong(task.due_at),
    task_status: task.task_status,
    task_status_label: TASK_LABEL[task.task_status] || '进行中',
    assign_status: assign.assign_status || '',
    assign_status_label: ASSIGN_LABEL[assign.assign_status] || '进行中',
    assign_status_class: ASSIGN_PILL[assign.assign_status] || 'hl-pill--unknown',
    creator_label: CREATOR_LABEL[task.creator_type] || '',
    accepted_label: assign.accepted_at ? time.formatShort(assign.accepted_at) : '',
    completed_label: assign.completed_at ? time.formatShort(assign.completed_at) : '',
    progress_label: progress.total_count
      ? `${progress.completed_count}/${progress.total_count} 人已完成`
      : '',
    files: (task.file_refs || []).map((f) => ({
      file_id: f.file_id,
      file_name: f.file_name,
      size_label: formatSize(f.file_size),
    })),
  };
}

/** Bytes to something a teacher reads. Display only. */
function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Whether 提交材料 can be entered, and if not, why (ticket 10 criterion 5).
 *
 * This returns a REASON, never an error. Both closures are normal states: a
 * finished task is finished, and the holiday is a season. The page renders
 * `reason` on the spot rather than letting a teacher tap into a refusal.
 *
 * It is an ENTRY, not a control — the write itself is ticket 11. Nothing on
 * this screen submits, edits or deletes.
 */
function submitEntry({ taskStatus, canWrite }) {
  if (CLOSED_TASK_STATUS.indexOf(taskStatus) !== -1) {
    return {
      disabled: true,
      reason: taskStatus === 't4' ? '任务已取消，不能再提交材料' : '任务已结束，不能再提交材料',
    };
  }
  if (!canWrite) {
    return { disabled: true, reason: '假期中暂不可提交，新学期开始后恢复' };
  }
  return { disabled: false, reason: '' };
}

/** Ticket 11 builds the submit screen. Until then, say so out loud. */
function openSubmit() {
  wx.showToast({ title: '提交材料尚未上线', icon: 'none' });
}

module.exports = {
  listPage,
  detail,
  submitEntry,
  openSubmit,
};
