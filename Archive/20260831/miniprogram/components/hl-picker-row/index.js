/**
 * hl-picker-row — 一行选择，底部弹起原生滚轮（票据 13）。
 *
 * SOURCE OF TRUTH: docs/frontend spec files/form-control-spec.md。它取代原型里的
 * 下拉列表：小程序不存在下拉列表这一形态，`<select>` 没有 WXML 对应物。
 *
 * 为什么是组件而不是每页抄一遍：选择行有三种静态状态、一条尺寸规则、三条行为规则，
 * 共七条。原型有 20 处 `<select>` 要迁移，各抄一遍就是七条规则乘二十次走样的机会。
 *
 * 三条行为规则（spec §4），全部靠平台既有语义达成，本文件不额外造机制：
 *   1. 滑动过程中页面数据不变 —— 不监听 `bindcolumnchange`，不做边滑边预览。
 *   2. 只有确认才写入 —— `bindchange` 是唯一的写入口。
 *   3. 取消不改变已选值 —— `bindcancel` 不 setData、不清值、不回退。
 *
 * 组件不持有选中值：`value` 是属性，父页面是唯一的持有者。组件只在确认时把新值
 * `triggerEvent` 出去。这样「取消不改变已选值」不必靠组件自律，它根本没有可改的东西。
 */

Component({
  // 行高与间距在 styles/form-rows.wxss，由 app.wxss 引入。官方文档：样式隔离下
  // app.wxss 的 class 默认不进组件，要 addGlobalClass 才进。少了这一行，这一行会
  // 渲染成一堆没有尺寸的裸文字，而且不会报任何错。
  options: {
    addGlobalClass: true,
  },

  properties: {
    // 标签，例如「年级」。
    label: { type: String, value: '' },
    // 选项，形如 [{ key, label }]。取值来自服务层的同一份来源，组件不认识枚举。
    options: { type: Array, value: [] },
    // 已选项的 key。空串即未选。
    value: { type: String, value: '' },
    // 必填只影响标签后的那个星号，不影响行为 —— 校验是表单的事，不是一行的事。
    required: { type: Boolean, value: false },
  },

  data: {
    // 滚轮读的是中文数组与下标；页面读的是 key。两者的换算只在这里发生。
    labels: [],
    index: 0,
    valueLabel: '',
  },

  observers: {
    'options, value': function onInputs(options, value) {
      const list = options || [];
      const index = list.findIndex((o) => o.key === value);
      this.setData({
        labels: list.map((o) => o.label),
        // 未选时滚轮停在第一项，这是它打开时的落点，不是一个已选值。
        index: index < 0 ? 0 : index,
        // 未知 key 与未选一样显示占位：§1.1 允许服务端先于本次构建增加编码，
        // 那时宁可显示「请选择」，也不显示一个教师读不懂的原值。
        valueLabel: index < 0 ? '' : list[index].label,
      });
    },
  },

  methods: {
    /** 确认。唯一的写入口（spec §4 规则 2）。 */
    onChange(e) {
      const index = Number(e.detail.value);
      const option = this.data.options[index];
      if (!option) return;
      this.triggerEvent('pick', { key: option.key, label: option.label });
    },

    /**
     * 取消。故意留空且故意存在：留空是规则 3 本身，存在是为了让下一个读代码的人
     * 看见这条规则被想过，而不是被忘了。
     */
    onCancel() {},
  },
});
