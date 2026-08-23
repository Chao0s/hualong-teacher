/**
 * 教研培训入口页 — APP-STRUCTURE.md screen id `TrainHome`.
 *
 * A bottom-bar destination. The tab needed somewhere to land, so this screen
 * carries `notInFlowchart` in the structure contract: it is not a Mermaid node.
 *
 * Thin by the ticket-08 template — it calls the service, setData, and forwards
 * the tap. The entries, their order and their refusal text all live in
 * services/module-entry.js, so adding a screen to this module is a one-line
 * change there and nothing here.
 */

const guard = require('../../utils/guard');
const moduleEntry = require('../../services/module-entry');

const MODULE_ID = 'teaching-research';

Page({
  data: {
    ready: false,
    sections: [],
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({
      ready: true,
      sections: moduleEntry.sectionsFor(MODULE_ID),
    });
  },

  onEntryTap(e) {
    moduleEntry.openEntry(MODULE_ID, e.detail.key);
  },
});
