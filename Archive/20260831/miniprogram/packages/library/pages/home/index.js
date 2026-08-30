/**
 * 课程库与资源库入口页 — APP-STRUCTURE.md screen id `CourseResourceHome`.
 *
 * 一个入口同时通向资源库与案例库。资源库是**第六个模块**，底部导航只有五项且五就是
 * 平台上限（DO-NOT-BUILD 14），所以它没有自己的导航项：首页常用入口的「课程资源」与
 * 教研培训入口页的「课程资源」都落在这一页。
 *
 * Thin by the ticket-08 template：两张卡片的文案与去向都在 services/library.js，
 * 案例库落地时改那里的一行，这一页不动。
 *
 * 原型 resource-center.html 还有一个搜索框与两条推荐架子。**两者都不建**：契约的资源
 * 与案例列表都不收搜索参数（`/library/resources` 只有 resource_tag／grade／
 * resource_status／class_id），一个打不出结果的搜索框比没有搜索框更糟；推荐架子在首页
 * 已经有一处（`/home/cases`），第二处会变成同一份数据的第二个真相。
 */

const guard = require('../../../../utils/guard');
const library = require('../../../../services/library');

Page({
  data: {
    ready: false,
    entries: [],
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true, entries: library.entries() });
  },

  onEntryTap(e) {
    library.open(e.currentTarget.dataset.key);
  },
});
