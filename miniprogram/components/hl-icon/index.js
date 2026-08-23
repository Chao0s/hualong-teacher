/**
 * hl-icon — the only place that knows where an icon file lives (ticket 09).
 *
 * A page writes the icon's NAME and COLOUR:
 *
 *     <hl-icon name="icon-07" color="muted" size="48rpx" />
 *
 * and never a path. Changing an icon's colour is a property change, not a
 * markup change, which is the whole point: 40-odd screens are about to
 * reference these files and none of them should hold `/assets/icons/...`.
 *
 * WHY PNG AND NOT INLINE SVG (实现决定 12): a Mini Program has no inline vector
 * element. The prototypes tinted one drawing four ways through `currentColor`
 * inherited from the parent; that mechanism does not survive the move to image
 * files, so each colour is a separate PNG and the tint becomes a property here.
 * There is no `currentColor` anywhere in this client, by design.
 *
 * DENSITY: the manifest ships @2x and @3x for every icon. This component
 * references @3x only, deliberately. Picking at runtime needs a platform API
 * for the device pixel ratio, and the official reference for it could not be
 * retrieved through the docs tool — guessing an API's availability is exactly
 * what the no-guessing rule forbids. `<image>` scales, rpx already normalises
 * across densities, and all 92 placeholders together weigh 33 KB, so serving
 * the larger file costs nothing measurable. Revisit when the designer's real
 * artwork lands and the sizes are known.
 */

const BASE = '/assets/icons';
const DENSITY = '@3x';

// The manifest's five tokens. A colour outside this set is a caller bug: the
// file will not exist and the icon renders blank, so fail loudly instead.
const COLOURS = ['accent', 'green', 'amber', 'blue', 'muted'];

Component({
  properties: {
    name: { type: String, value: '' },
    color: { type: String, value: 'accent' },
    size: { type: String, value: '44rpx' },
  },

  data: { src: '' },

  observers: {
    'name, color': function resolve(name, color) {
      if (!name) {
        this.setData({ src: '' });
        return;
      }
      if (COLOURS.indexOf(color) === -1) {
        throw new Error(`hl-icon: 未知颜色 "${color}"，可用：${COLOURS.join('/')}`);
      }
      this.setData({ src: `${BASE}/${name}-${color}${DENSITY}.png` });
    },
  },
});
