# 原型可點區塊候選清單（給人審，未改任何原型）

原型 56 份。**一個信號一個計數，不合成一個總數。**

| 信號 | 合計 | 可信度 |
|---|---:|---|
| `<button>` | 158 | 高 —— 標籤本身就是意圖 |
| `onclick=` | 1 | 高 —— 但有幾處要現場看 |
| `<a href>` | 299 | 中 —— 含純跳頁的導航，不全是意圖 |
| 類名像能點（非 button） | 456 | 低 —— 這是候選，要你審 |
| 已有 `data-ui` | 89 | —— 現行公約，只標表單欄位 |
| 已有 `data-intent` | 0 | —— 還沒有 |

候選合計 746 條。

## 逐檔案

| 原型 | button | onclick | a[href] | 類名像能點 | 候選小計 |
|---|---:|---:|---:|---:|---:|
| `assessment-tool` | 6 | 0 | 1 | 3 | 10 |
| `case-detail` | 0 | 0 | 3 | 9 | 9 |
| `case-library` | 16 | 0 | 15 | 27 | 49 |
| `community-coeducation` | 4 | 0 | 1 | 4 | 9 |
| `component-showcase` | 2 | 0 | 15 | 19 | 29 |
| `comprehensive-assessment-class-report` | 0 | 0 | 3 | 2 | 4 |
| `comprehensive-assessment-form` | 1 | 0 | 1 | 5 | 7 |
| `comprehensive-assessment-report` | 2 | 0 | 3 | 5 | 9 |
| `comprehensive-coordination` | 0 | 0 | 12 | 7 | 12 |
| `coordination-file-list` | 3 | 0 | 8 | 1 | 12 |
| `course-building` | 0 | 0 | 4 | 13 | 17 |
| `growth-book-edit` | 3 | 0 | 3 | 3 | 7 |
| `growth-book-sample` | 3 | 0 | 2 | 2 | 7 |
| `growth-book-section-edit` | 18 | 0 | 1 | 3 | 22 |
| `growth-book-section-materials` | 6 | 0 | 1 | 1 | 8 |
| `growth-book-task-manage` | 2 | 0 | 1 | 0 | 3 |
| `growth-book-time-manage` | 9 | 0 | 1 | 0 | 10 |
| `growth-book-view` | 2 | 0 | 1 | 1 | 4 |
| `growth-book` | 4 | 0 | 3 | 6 | 11 |
| `growth-comprehensive-assessment` | 4 | 0 | 5 | 9 | 15 |
| `growth-record` | 0 | 0 | 4 | 6 | 8 |
| `home-school-moment-feed` | 6 | 0 | 1 | 3 | 10 |
| `home-school-moment-publish` | 1 | 0 | 1 | 10 | 12 |
| `home-school-moments` | 0 | 0 | 3 | 1 | 3 |
| `home-school` | 0 | 0 | 9 | 14 | 19 |
| `home` | 0 | 0 | 16 | 30 | 35 |
| `my-training` | 0 | 0 | 5 | 5 | 6 |
| `parent-evaluation-detail` | 0 | 0 | 1 | 1 | 2 |
| `parent-evaluation-publish` | 1 | 0 | 4 | 4 | 6 |
| `parent-task-detail` | 0 | 0 | 1 | 1 | 2 |
| `parent-task-publish` | 3 | 0 | 1 | 2 | 6 |
| `parent-tasks` | 0 | 0 | 6 | 9 | 10 |
| `party-activity-detail` | 0 | 0 | 2 | 7 | 8 |
| `party-activity-list` | 0 | 0 | 6 | 5 | 6 |
| `party-brand-detail` | 0 | 0 | 1 | 7 | 8 |
| `party-brand-list` | 0 | 0 | 5 | 4 | 5 |
| `party-study-detail` | 3 | 0 | 1 | 0 | 4 |
| `party-study-list` | 0 | 0 | 6 | 5 | 6 |
| `resource-center` | 1 | 0 | 14 | 15 | 24 |
| `resource-detail` | 0 | 0 | 3 | 8 | 8 |
| `resource-library` | 6 | 0 | 18 | 48 | 60 |
| `school-affairs` | 0 | 0 | 20 | 9 | 20 |
| `teacher-evaluation` | 0 | 0 | 5 | 6 | 8 |
| `teacher-message-detail` | 0 | 0 | 2 | 0 | 2 |
| `teacher-message` | 5 | 0 | 3 | 5 | 11 |
| `teacher-monthly-evaluation` | 0 | 0 | 26 | 26 | 28 |
| `teacher-monthly-form` | 5 | 0 | 1 | 2 | 8 |
| `teacher-profile` | 13 | 0 | 7 | 39 | 59 |
| `teacher-task-detail` | 5 | 0 | 1 | 2 | 8 |
| `teacher-tasks` | 0 | 0 | 4 | 3 | 4 |
| `teacher-term-evaluation` | 4 | 0 | 8 | 15 | 21 |
| `teacher-term-form` | 5 | 0 | 1 | 2 | 8 |
| `training-center` | 0 | 0 | 16 | 24 | 29 |
| `training-detail` | 4 | 1 | 3 | 2 | 7 |
| `training-list` | 0 | 0 | 9 | 6 | 9 |
| `upload-resource` | 11 | 0 | 1 | 10 | 22 |

## 樣本（前 60 條候選）

| 原型 | 標籤 | 類名 | 文案 | 信號 |
|---|---|---|---|---|
| `assessment-tool` | `a` | `back` | ‹ 质量评估 — <div class="sum- | anchor |
| `assessment-tool` | `button` | `chip on` | 全部 120 未评 120 低分 0 <main class= | button |
| `assessment-tool` | `button` | `chip` | 未评 120 低分 0 <div class="empty | button |
| `assessment-tool` | `button` | `chip` | 低分 0 <div | button |
| `assessment-tool` | `button` | `save-btn` | 保存 已保存 (function(){ var TOOL = window.ASSE | button |
| `assessment-tool` | `span` | `chip-score` | '+chipText(cur)+' '; head.addEventListener | class |
| `assessment-tool` | `button` | `sbtn` | '+o.score+' '+o.label+' '; }); btns+=' ';  | button |
| `assessment-tool` | `button` | `rub-toggle` | › 评分标准（1 / 3 / 5 分锚点） ' +' ' + rrow('1',in | button |
| `assessment-tool` | `label` | `evi-add` | ＋ 添加佐证' +' ' +' '; var note='<div class="f | class |
| `assessment-tool` | `span` | `chip-score '+chipCls(v)+'` | '+chipText(v)+' '; persist(); refreshSumma | class |
| `case-detail` | `a` | `back-btn` | ← 案例详情 祠堂里的故事 <span class= | anchor |
| `case-detail` | `div` | `detail-card` | 祠堂里的故事 大班 社会 乡情 | class |
| `case-detail` | `div` | `tag-row` | 大班 社会 乡情 活动简介 本活动以番禺沙湾留耕堂（何氏大宗祠）为本土资源载体，引导 | class |
| `case-detail` | `span` | `tag` | 大班 社会 乡情 活动简介 本活动以番禺沙湾留耕堂（何氏大宗祠）为本土资源载体，引导 | class |
| `case-detail` | `span` | `tag` | 社会 乡情 活动简介 本活动以番禺沙湾留耕堂（何氏大宗祠）为本土资源载体，引导大班幼 | class |
| `case-detail` | `span` | `tag` | 乡情 活动简介 本活动以番禺沙湾留耕堂（何氏大宗祠）为本土资源载体，引导大班幼儿走近 | class |
| `case-detail` | `a` | `link-card` | 关联资源：沙湾留耕堂 查看资源解读、获取方式和转化路径 <span cla | anchor |
| `case-detail` | `a` | `btn-dl primary` | 下载Word详案 查看完整活动目标、流程、延伸与评价反思 ↓ <div cla | anchor |
| `case-detail` | `span` | `btn-note` | 查看完整活动目标、流程、延伸与评价反思 ↓ Word版完整详案 | class |
| `case-library` | `a` | `` | 案例库 <div cl | anchor |
| `case-library` | `button` | `filter-chip on` | 全部 小班 中班 <button class="filter-chip" type= | button |
| `case-library` | `button` | `filter-chip` | 小班 中班 大班 <div class="filter-line" da | button |
| `case-library` | `button` | `filter-chip` | 中班 大班 <button class="filter-chip on" type= | button |
| `case-library` | `button` | `filter-chip` | 大班 全部 <button class="filter-chip" type="bu | button |
| `case-library` | `button` | `filter-chip on` | 全部 健康 语言 <button class="filter-chip" type= | button |
| `case-library` | `button` | `filter-chip` | 健康 语言 社会 <button class="filter-chip" type= | button |
| `case-library` | `button` | `filter-chip` | 语言 社会 科学 <button class="filter-chip" type= | button |
| `case-library` | `button` | `filter-chip` | 社会 科学 艺术 <div class="filter-line" da | button |
| `case-library` | `button` | `filter-chip` | 科学 艺术 <button class="filter-chip on" type= | button |
| `case-library` | `button` | `filter-chip` | 艺术 全部 <button class="filter-chip" type="bu | button |
| `case-library` | `button` | `filter-chip on` | 全部 集体 区域 <button class="filter-chip" type= | button |
| `case-library` | `button` | `filter-chip` | 集体 区域 主题探究 <button class="filter-chip" typ | button |
| `case-library` | `button` | `filter-chip` | 区域 主题探究 家园社共育 <button class="filter-chip"  | button |
| `case-library` | `button` | `filter-chip` | 主题探究 家园社共育 数字化 <div cl | button |
| `case-library` | `button` | `filter-chip` | 家园社共育 数字化 案例清单 全部案例 <div class="case-list" | button |
| `case-library` | `button` | `filter-chip` | 数字化 案例清单 全部案例 <a class="case-card" href="c | button |
| `case-library` | `a` | `case-card` | 祠堂 探访 祠堂里的故事 大班 < | anchor |
| `case-library` | `div` | `card-body` | 祠堂里的故事 大班 社会 集体教学 <span c | class |
| `case-library` | `div` | `card-top` | 祠堂里的故事 大班 社会 集体教学 主题探究 </div | class |
| `case-library` | `a` | `case-card` | 龙舟 竞渡 龙舟竞渡 大班 <span cla | anchor |
| `case-library` | `div` | `card-body` | 龙舟竞渡 大班 健康 集体教学 <span class="field-pi | class |
| `case-library` | `div` | `card-top` | 龙舟竞渡 大班 健康 集体教学 区域 </div | class |
| `case-library` | `a` | `case-card` | 美食 地图 番禺美食地图 中班 <span c | anchor |
| `case-library` | `div` | `card-body` | 番禺美食地图 中班 科学 区域 <span class="field-pi | class |
| `case-library` | `div` | `card-top` | 番禺美食地图 中班 科学 区域 数字化 </di | class |
| `case-library` | `a` | `case-card` | 童谣 共唱 粤语童谣共唱 小班 <span cl | anchor |
| `case-library` | `div` | `card-body` | 粤语童谣共唱 小班 语言 家园社共育 <span class="field | class |
| `case-library` | `div` | `card-top` | 粤语童谣共唱 小班 语言 家园社共育 区域 </ | class |
| `case-library` | `a` | `case-card` | 纹样 拓印 砖雕纹样拓印 中班 <span c | anchor |
| `case-library` | `div` | `card-body` | 砖雕纹样拓印 中班 艺术 主题探究 <span class="field- | class |
| `case-library` | `div` | `card-top` | 砖雕纹样拓印 中班 艺术 主题探究 数字化 </ | class |
| `case-library` | `a` | `case-card` | 桥梁 测量 桥有多长 大班 <span clas | anchor |
| `case-library` | `div` | `card-body` | 桥有多长 大班 科学 主题探究 <span class="field-pi | class |
| `case-library` | `div` | `card-top` | 桥有多长 大班 科学 主题探究 数字化 </di | class |
| `case-library` | `a` | `case-card` | 安全 路线 我会安全过街 小班 <span c | anchor |
| `case-library` | `div` | `card-body` | 我会安全过街 小班 健康 家园社共育 <span class="field | class |
| `case-library` | `div` | `card-top` | 我会安全过街 小班 健康 家园社共育 数字化 < | class |
| `case-library` | `a` | `case-card` | 社区 小店 社区小店的一天 中班 <span class= | anchor |
| `case-library` | `div` | `card-body` | 社区小店的一天 中班 社会 区域 <span class="field-p | class |
| `case-library` | `div` | `card-top` | 社区小店的一天 中班 社会 区域 集体教学 </ | class |