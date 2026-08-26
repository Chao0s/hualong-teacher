/**
 * 综合协调入口页 — APP-STRUCTURE.md screen id `CoordHome`.
 *
 * A bottom-bar destination. The tab needed somewhere to land, so this screen
 * carries `notInFlowchart` in the structure contract: it is not a Mermaid node.
 *
 * 版面按原型 comprehensive-coordination.html：说明卡加三节共七张类目卡，一类一卡。
 * 卡片带着类目进列表页，那一页据此预选页内标签——教师点「安全管理」就落在安全管理
 * 上，不必进去再点一次。
 *
 * Thin by the ticket-08 template — it calls the service, setData, and forwards
 * the tap. 卡片表、去向与门都在 services/coordination.js。
 */

const guard = require('../../utils/guard');
const coordination = require('../../services/coordination');

Page({
  data: {
    ready: false,
    sections: [],
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({
      ready: true,
      sections: coordination.entrySections(),
    });
  },

  onEntryTap(e) {
    coordination.openEntry(e.currentTarget.dataset.key);
  },
});
