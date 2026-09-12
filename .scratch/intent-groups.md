# 原型意圖候選：按類名分組

候選元素 746 條 → **分組後 321 個 (原型, 類名) 組合**。

- **重複出現的組**（同一個控件重複 N 次，多半是**一個意圖**）：133 組，覆蓋 558 條
- **只出現一次的組**（多半是**一個不同的意圖**）：188 組

**判讀**：真正要標的意圖數，**接近分組數，不是 746**。重複的卡片是「一類意圖套在 N 筆資料上」。

## 重複最多的 25 組（一眼看出「重複」）

| 原型 | 主類名 | 次數 | 標籤 | 文案樣本 |
|---|---|---:|---|---|
| `teacher-monthly-evaluation` | `dot-link` | 24 | a | <span class="dot-cell done" title= · 李雨萱 |
| `case-library` | `filter-chip` | 16 | button | 全部 小班 中班 <button class="filter · 小班 中班 大 |
| `teacher-profile` | `` | 13 | a/button | 个人档案 <button class="edit · 预览 下载 <di |
| `teacher-profile` | `form-row` | 13 | div | 姓名 林晓敏 任教班级 中一班 <div class="f · 任教班级 中一班 |
| `resource-library` | `resource-entry` | 12 | a | <path d="M10 · <path d="M9 8a3 3 0 |
| `resource-library` | `entry-icon` | 12 | div | <div class · </s |
| `resource-library` | `entry-name` | 12 | div | 香云纱纹样 衣 <svg width="21" height="21 · 广绣小 |
| `resource-library` | `entry-tag` | 12 | div | 衣 <svg width="21" height="21" view · 食 < |
| `case-library` | `case-card` | 9 | a | 祠堂 探访 祠堂里的故事 大班 < · 龙舟 竞渡 龙舟竞渡 大班 <div c |
| `case-library` | `card-body` | 9 | div | 祠堂里的故事 大班 社会 <span class="field-pi · 龙舟竞 |
| `case-library` | `card-top` | 9 | div | 祠堂里的故事 大班 社会 集体教学 <span class="fie · 龙舟竞 |
| `school-affairs` | `item` | 9 | a | 学 新时代幼儿园党建工作要点 政策文件 06-18 办公室 · 学 师德师风专题 |
| `home-school-moment-publish` | `check-card` | 8 | label | 陈小明 李雨萱 · 李雨萱 张力轩 |
| `comprehensive-coordination` | `entry-card` | 7 | a | 政 政策法规 政策文件与制度依据 · 通 通知文件 园内通知与文件流转 <a c |
| `school-affairs` | `` | 7 | a | 全部 › 学 <span class=" · 全部 › 活 <span clas |
| `teacher-term-evaluation` | `check-row` | 7 | label | 全选 选择当前进度表中的全部幼儿 陈小明 已完成 · 可导出 / 可 · 陈小明 |
| `coordination-file-list` | `` | 6 | a | 首页 <svg viewBox=" · 党建管理 < |
| `growth-book-section-edit` | `tool-btn` | 6 | button | + 页 删页 + 图片</butt · 删页 + 图片 <button clas |
| `growth-book-time-manage` | `text-button` | 6 | button | ${pendingRemoveId === item.id ? '确 · 撤销  |
| `resource-library` | `standard-chip` | 6 | button | 全部 衣 食 <button class="standard-c · 衣 食 住 |
| `teacher-message` | `dot-link` | 6 | a/button | 李雨萱 <span class= · 张力轩 <spa |
| `teacher-profile` | `item` | 6 | div | 本科学历证书 · 心理学.pdf 学历证书 预览< · 硕士学历证书 · 学前教 |
| `teacher-profile` | `item-title` | 6 | div | 本科学历证书 · 心理学.pdf 学历证书 预览 <a downlo · 硕士学 |
| `teacher-profile` | `badge-row` | 6 | div | 学历证书 预览 <a download="本科学历证书 · 心理学. · 学历证 |
| `teacher-term-evaluation` | `dot-link` | 6 | a | 李雨萱 <span class="dot-c · 张力轩 <span class |

## 只出現一次的組（前 40，這些最可能是獨立意圖）

| 原型 | 主類名 | 標籤 | 文案 |
|---|---|---|---|
| `assessment-tool` | `back` | a | ‹ 质量评估 — |
| `assessment-tool` | `save-btn` | button | 保存 已保存 (function(){ var TO |
| `assessment-tool` | `sbtn` | button | '+o.score+' '+o.label+' '; }); btn |
| `assessment-tool` | `rub-toggle` | button | › 评分标准（1 / 3 / 5 分锚点） ' +' ' + rro |
| `assessment-tool` | `evi-add` | label | ＋ 添加佐证' +' ' +' '; var note |
| `case-detail` | `back-btn` | a | ← 案例详情 祠堂里的故事 |
| `case-detail` | `detail-card` | div | 祠堂里的故事 大班 社会 乡情</spa |
| `case-detail` | `tag-row` | div | 大班 社会 乡情 活动简介 本活动以番禺沙湾留耕堂（何氏大宗祠）为本 |
| `case-detail` | `link-card` | a | 关联资源：沙湾留耕堂 查看资源解读、获取方式和转化路径 </div |
| `case-detail` | `btn-dl` | a | 下载Word详案 查看完整活动目标、流程、延伸与评价反思 ↓ </ |
| `case-detail` | `btn-note` | span | 查看完整活动目标、流程、延伸与评价反思 ↓ <div class=" |
| `case-library` | `on` | a | 教研培训</sp |
| `community-coeducation` | `back` | a | ‹ 社区共育 时间</la |
| `component-showcase` | `todo-card` | a | 传 上传资源 提交审核 <div class |
| `component-showcase` | `todo-title` | span | 上传资源 提交审核 Task 任务卡片 < |
| `component-showcase` | `task-card` | a | 衣食住行艺课程资源包共建 待接收 截止 6月28日 · 教研组发起  |
| `component-showcase` | `resource-card` | a | 社 祠堂里的故事 社会 · 住 <d |
| `component-showcase` | `resource-tag` | span | 社会 · 住 Case 案例卡片 <a class="case-ca |
| `component-showcase` | `case-card` | a | 祠堂 探访 祠堂里的故事 大班 社会< |
| `component-showcase` | `card-body` | div | 祠堂里的故事 大班 社会 集体教学 <span class="fie |
| `component-showcase` | `card-top` | div | 祠堂里的故事 大班 社会 集体教学 主题探究 |
| `component-showcase` | `entry-card` | a | 政 政策法规 政策文件与制度依据 Hub 聚合卡片 <div cla |
| `component-showcase` | `hub-card` | a | <pa |
| `component-showcase` | `eval-entry` | a | 月度评价 Moment 动态卡片 <article class="m |
| `component-showcase` | `moment-card` | article | 陈 陈小明家长 今天 09:18 小明在祠堂门口找到木雕花纹，说“像 |
| `component-showcase` | `add-material` | button | + 加入成长册 Summary 汇总卡片 <div clas |
| `component-showcase` | `summary-card` | div | — 已评 0/124 · 草稿自动保存 保存评估 <sec |
| `component-showcase` | `quick-item` | a | <path d="M8 7h8M8 |
| `component-showcase` | `quick-icon` | div | </ |
| `component-showcase` | `quick-label` | span | 教研培训 Button 按钮 <a class="btn" href |
| `component-showcase` | `back` | a | ‹ 质量评估 Status Bar 状态栏 |
| `component-showcase` | `on` | a | <s |
| `component-showcase` | `form-row` | div | 姓名 List I |
| `component-showcase` | `item` | span | 完成 Dot Cell 点评格 <i class="dot-c |
| `comprehensive-assessment-class-report` | `` | a | 班级评估报告 |
| `comprehensive-assessment-class-report` | `btn-row` | div | 继续评估 返回进度 <script src= |
| `comprehensive-assessment-form` | `` | a | 开始综合评估 |
| `comprehensive-assessment-form` | `summary-card` | div | — 已评 0/124 · 草稿自动保存 保存评估 |
| `comprehensive-assessment-form` | `btn` | button | 保存评估 综合评估已保存 const domains = [{"id |
| `comprehensive-assessment-form` | `item` | div | ${item.name}${item.m ? ' 实测换算 ' :  |

## 逐原型

| 原型 | `<button>` | (原型,類名) 組數 |
|---|---:|---:|
| `component-showcase` | 2 | 24 |
| `teacher-profile` | 13 | 15 |
| `home` | 0 | 13 |
| `growth-book-section-edit` | 18 | 12 |
| `upload-resource` | 11 | 12 |
| `resource-center` | 1 | 10 |
| `training-center` | 0 | 9 |
| `assessment-tool` | 6 | 7 |
| `case-detail` | 0 | 7 |
| `comprehensive-assessment-form` | 1 | 7 |
| `comprehensive-assessment-report` | 2 | 7 |
| `coordination-file-list` | 3 | 7 |
| `growth-book` | 4 | 7 |
| `growth-comprehensive-assessment` | 4 | 7 |
| `home-school` | 0 | 7 |
| `parent-tasks` | 0 | 7 |
| `resource-library` | 6 | 7 |
| `teacher-term-evaluation` | 4 | 7 |
| `case-library` | 16 | 6 |
| `course-building` | 0 | 6 |
| `growth-book-edit` | 3 | 6 |
| `growth-book-section-materials` | 6 | 6 |
| `party-activity-detail` | 0 | 6 |
| `teacher-task-detail` | 5 | 6 |
| `growth-book-sample` | 3 | 5 |
| `growth-record` | 0 | 5 |
| `home-school-moment-feed` | 6 | 5 |
| `home-school-moment-publish` | 1 | 5 |
| `parent-task-publish` | 3 | 5 |
| `resource-detail` | 0 | 5 |
| `teacher-message` | 5 | 5 |
| `teacher-monthly-form` | 5 | 5 |
| `teacher-term-form` | 5 | 5 |
| `growth-book-time-manage` | 9 | 4 |
| `parent-evaluation-publish` | 1 | 4 |
| `party-study-detail` | 3 | 4 |
| `school-affairs` | 0 | 4 |
| `teacher-evaluation` | 0 | 4 |
| `teacher-monthly-evaluation` | 0 | 4 |
| `training-detail` | 4 | 4 |
| `community-coeducation` | 4 | 3 |
| `comprehensive-assessment-class-report` | 0 | 3 |
| `comprehensive-coordination` | 0 | 3 |
| `growth-book-task-manage` | 2 | 3 |
| `growth-book-view` | 2 | 3 |
| `home-school-moments` | 0 | 3 |
| `party-brand-detail` | 0 | 3 |
| `training-list` | 0 | 3 |
| `my-training` | 0 | 2 |
| `parent-evaluation-detail` | 0 | 2 |
| `parent-task-detail` | 0 | 2 |
| `party-activity-list` | 0 | 2 |
| `party-brand-list` | 0 | 2 |
| `party-study-list` | 0 | 2 |
| `teacher-message-detail` | 0 | 2 |
| `teacher-tasks` | 0 | 2 |