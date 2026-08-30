/**
 * hl-progress-grid — 幼儿 × 状态的通用网格（票据 19）。
 *
 * **这个组件不知道自己在渲染哪个模块。** 它收到的只有列定义与行数据；里面没有
 * 「在园时光」「亲子任务」「月度评价」这些词，也没有任何一处按模块分支。十三处同类
 * 表格换用它时只提供数据与列定义（票据 19 Notes）—— 内置一处模块专属逻辑，第十四处
 * 就会带着一个不属于它的分支上线。
 *
 * ── 接口 ─────────────────────────────────────────────────────────────────────
 *
 *   columns   [{ key, label }]                    列，顺序即显示顺序
 *   rows      [{ key, name, cells: [...] }]       行，顺序即显示顺序
 *             cells 与 columns **按下标对齐**，每格 { key, done, hint }
 *   nameLabel 姓名列的表头文字（'幼儿'／'教师'／…），组件自己不写死
 *   tappable  单元格是否可点。**默认 false**
 *   emptyText 没有行时说的那一句
 *
 *   bind:celltap -> { rowKey, colKey }
 *
 * `tappable` 默认 false 是有理由的，不是省事：进度页只读，不出现补录或代填入口
 * （票据 19 验收项）。可点是**要显式要**的那一种能力，用在教师点进自己的表单（在园
 * 时光按周补发）；家长提交的那张表教师点不进去，也不该点得进去。默认可点的话，
 * 复用它的第十三张表只要忘了关就多出一个代填入口。
 *
 * ── 姓名列为什么不在 scroll-view 里 ─────────────────────────────────────────
 *
 * 「列较多时横向滚动而姓名列不随之滚走」（票据 19 验收项）。做法是**结构上的**：
 * 姓名列是 scroll-view 的兄弟节点，横向滚动的只有右边那半。不用 `position: sticky`
 * —— sticky 在小程序两套渲染器上的表现不一致，而且它是一条「希望它别动」的样式，
 * 结构上让它根本不在滚动容器里则是一条事实。
 *
 * ── 两态，不是三态 ───────────────────────────────────────────────────────────
 *
 * 完成与未完成用两个颜色点表示，不用三态文字（票据 19 验收项）。**每个点带
 * `aria-label`**，因为一个颜色点对读屏软件是空的 —— 颜色是给眼睛的，`hint` 是给
 * 耳朵的，两者说的是同一件事。`hint` 由调用方给，组件不拼它：拼一句「已完成」就等于
 * 假设了所有模块的说法一样。
 */

Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    columns: { type: Array, value: [] },
    rows: { type: Array, value: [] },
    nameLabel: { type: String, value: '幼儿' },
    tappable: { type: Boolean, value: false },
    emptyText: { type: String, value: '这个班还没有数据。' },
  },

  methods: {
    /**
     * 单元格点击。不可点时**什么也不发** —— 让页面去判断「现在能不能点」，就等于
     * 把这条规则复制到每一个使用者身上。
     */
    onCellTap(e) {
      if (!this.data.tappable) return;
      const { rowKey, colKey } = e.currentTarget.dataset;
      this.triggerEvent('celltap', { rowKey, colKey });
    },
  },
});
