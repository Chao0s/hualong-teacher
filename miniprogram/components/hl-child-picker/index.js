/**
 * hl-child-picker — 班级与幼儿选择器，单选与多选一套（票据 17）。
 *
 * SOURCE OF TRUTH: docs/frontend spec files/form-control-spec.md。本组件在那份
 * spec 里新增一节「§2.3 名册型多选」，理由写在下面，也写进 spec 本身。
 *
 * ── 形态是怎么判出来的 ───────────────────────────────────────────────────────
 *
 * 按 spec §1 的三问，顺序问：
 *
 *   单选（月度评价、学期评价、综合评价、教师留言各选一名幼儿）
 *     第 1 问「是否多选」答否 -> 第 2 问「≤6 项且取值固定」答否（一班约 30 人，
 *     且取值来自服务端名册）-> 第 3 问命中，**原生滚轮**。spec §2.2 已经把这一格
 *     判成滚轮，本组件照它执行，不另判一次 —— 所以单选模式直接复用
 *     `hl-picker-row`，一处实现。
 *
 *   多选（在园时光的本次涉及幼儿、亲子任务的下发对象）
 *     第 1 问答是 -> 判**横排标签**。但一班约 30 人，铺成标签是一面墙，正是第 3 问
 *     要防的那件事 —— 与「关联资源」在 spec §2.2 撞上的是同一个空隙。
 *
 * **本次取的做法与关联资源那一条不同，理由是两件事的形状不同：**
 *
 *   关联资源  几十上百条里挑一到三条。**要找**，所以滚轮负责找，标签显示已选。
 *   班级名册  三十条里挑二十几条。**不用找**，教师认识每一个名字；而且这里真正
 *             要看的是**谁没被选中** —— 弹层把没选中的那几个藏起来，恰好藏掉了
 *             教师唯一要确认的东西（原型 home-school-moment-publish.html 的
 *             「已勾选 7 / 8 人」与覆盖率条说的就是这件事）。
 *
 * 所以多选取**就地勾选名册**：一屏之内逐行勾，带全选与清空，并显示已选人数与占比。
 * 这是三问之外的第二条先例，与关联资源那条并列；第三处出现同类组合时再决定要不要
 * 把它们写成一条正式规则。
 *
 * ── 班级为什么不是一个可选项 ─────────────────────────────────────────────────
 *
 * `class_id` 在契约 §7.3 是 derived 层：服务端按登录上下文设值，客户端提交被忽略
 * （DO-NOT-BUILD 8）。一名教师一个班，班级不是他能挑的东西。所以班级在这里是**一行
 * 说明**，不是一个选择位 —— 做成可选会让人以为客户端能改它，而那个值发出去也不生效。
 *
 * ── 组件不持有选中值 ─────────────────────────────────────────────────────────
 *
 * `value` 是属性，父页面是唯一的持有者；组件只在变更时 `triggerEvent`。与
 * `hl-picker-row` 同一条理由：持有者只有一个，就没有两份状态要对齐。
 *
 * `value` 在两种模式下都是**数组**。单选模式写 `[id]` 或 `[]`。一种形状、一个事件，
 * 所以一页从单选改成多选只改一个属性，页面的读写代码一行不动。
 */

Component({
  // 行高与间距在 styles/form-rows.wxss 与 app.wxss，由 app.wxss 统一引入。样式隔离
  // 下 app.wxss 的 class 默认不进组件，要 addGlobalClass 才进（同 hl-picker-row）。
  options: {
    addGlobalClass: true,
  },

  properties: {
    // 'single' 走滚轮，'multi' 走勾选名册。默认单选：多出来的那条路要显式要。
    mode: { type: String, value: 'single' },
    // 标签，例如「本次涉及幼儿」。
    label: { type: String, value: '幼儿' },
    // 班级名，只读说明。空串时不渲染那一行。
    className: { type: String, value: '' },
    // 名册，形如 [{ child_id, child_name }]，取值来自服务层的同一份来源。
    children: { type: Array, value: [] },
    // 已选的 child_id 数组。两种模式同一种形状。
    value: { type: Array, value: [] },
    // 必填只影响标签后的那个星号，不影响行为 —— 校验是表单的事，不是一行的事。
    required: { type: Boolean, value: false },
    // 只读态（假期、内容已锁定）。只读时不触发任何事件。
    disabled: { type: Boolean, value: false },
  },

  data: {
    // 滚轮读的是 [{key,label}]；名册读的是带 picked 标记的行。两种投影都在这里算，
    // 页面因此不必为了喂组件而准备第二份数据。
    pickerOptions: [],
    pickerValue: '',
    rows: [],
    pickedCount: 0,
    totalCount: 0,
    // 「已勾选 7 / 8 人」那一行的占比。原型用它，教师靠它一眼看出漏了谁。
    pickedRate: 0,
    allPicked: false,
  },

  observers: {
    'children, value': function onInputs(children, value) {
      const list = children || [];
      const picked = value || [];
      const rows = list.map((child) => ({
        childId: child.child_id,
        childName: child.child_name,
        picked: picked.indexOf(child.child_id) !== -1,
      }));
      const pickedCount = rows.filter((r) => r.picked).length;
      this.setData({
        pickerOptions: list.map((c) => ({ key: String(c.child_id), label: c.child_name })),
        pickerValue: picked.length ? String(picked[0]) : '',
        rows,
        pickedCount,
        totalCount: rows.length,
        pickedRate: rows.length ? Math.round((pickedCount / rows.length) * 100) : 0,
        allPicked: rows.length > 0 && pickedCount === rows.length,
      });
    },
  },

  methods: {
    /** 滚轮确认。单选模式唯一的写入口（spec §4 规则 2）。 */
    onPick(e) {
      if (this.data.disabled) return;
      const childId = Number(e.detail.key);
      if (!childId) return;
      this.emit([childId]);
    },

    /** 勾一个幼儿。点一次进，再点一次出。 */
    onRowTap(e) {
      if (this.data.disabled) return;
      const childId = Number(e.currentTarget.dataset.childId);
      const current = this.data.value || [];
      const next = current.indexOf(childId) === -1
        ? current.concat([childId])
        : current.filter((id) => id !== childId);
      this.emit(next);
    },

    /**
     * 全选与清空是同一个入口：已经全选就清空，否则全选。
     * 两个按钮里总有一个是灰的，不如一个按钮说清楚它现在会做什么。
     */
    onToggleAll() {
      if (this.data.disabled) return;
      if (this.data.allPicked) {
        this.emit([]);
        return;
      }
      this.emit((this.data.children || []).map((c) => c.child_id));
    },

    /**
     * 变更出口。同时给出 `childIds` 与被选中的整行，因为发布前的预览要显示姓名，
     * 而姓名只有名册知道 —— 让页面拿着 id 再回名册查一次，就是第二份换算。
     */
    emit(childIds) {
      const list = this.data.children || [];
      this.triggerEvent('change', {
        childIds,
        children: childIds
          .map((id) => list.find((c) => c.child_id === id))
          .filter(Boolean),
      });
    },
  },
});
