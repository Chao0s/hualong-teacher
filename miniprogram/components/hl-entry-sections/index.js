/**
 * hl-entry-sections — the shape every module entry page has (ticket 09).
 *
 * The four bottom-bar modules differ in their entries, not in their layout, so
 * the layout lives here once. A page passes the view-ready groups from
 * services/module-entry.js and listens for `tapentry`; it owns no markup.
 */

Component({
  properties: {
    sections: { type: Array, value: [] },
  },

  methods: {
    onTap(e) {
      this.triggerEvent('tapentry', { key: e.currentTarget.dataset.key });
    },
  },
});
