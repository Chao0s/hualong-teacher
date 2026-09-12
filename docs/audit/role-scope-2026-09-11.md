# 角色 × 操作 × scope 对照表

只读产物，**没有改动契约任何字节**。生成自 `G:\My Drive\Workplace\China KG Platform\hualong-backend\api\openapi.yaml`。

用途：教师端与家长端可能合并成一个客户端、共用同一批 API 调用。**契约已经按角色分范围**
（同一路径多条 predicate，见下表），但此前没有任何一处把它们并排列出来。这张表就是那面镜子。

**结论先说：服务端不需要为「合并」改任何东西。** 角色来自**会话票**，不是请求体 ——
把角色放进请求参数会是一条提权面。合并后错角色的票调教师端操作，按契约 §7.2 回
**404 而不是 403**（这条早已定下，见 `/roles` 页顶部那句）。

---

## 一、计数

| 项 | 数 |
|---|---|
| 操作总数 | 167 |
| **声明 >1 个角色的** | **15** |
| 同时给教师端与家长端的 | **9** |
| 带权限码 `x-hualong-permission` 的 | 44 |
| 写了 `x-hualong-scope` 的 | 93 |
| **多角色但范围只写在 description 里**（机器抓不到，要人读） | **12** |
| 无角色且非公开（**缺陷**） | 0 |
| 教师端可达 | 105 |

角色逻辑名 → 哪个端：`teacher` = 教师端小程序；`parent` = 家长端小程序；`admin-pc` = 管理端 PC 后台；`partner-account` = 合作园帐户。
**逻辑名与「哪个端」不是一对一** —— 合并客户端之后这件事正是要看的地方。

---

## 二、声明了多个角色的操作（15 条）—— 合并后风险最高的这一批

| 方法 | 路径 | operationId | 角色 | 范围写在哪 | 权限码 |
|---|---|---|---|---|---|
| GET | `/auth/session` | `getSession` | teacher、parent、admin-pc、partner-account | **description 里（要人读）** | — |
| DELETE | `/auth/session` | `revokeSession` | teacher、parent、admin-pc、partner-account | **description 里（要人读）** | — |
| POST | `/media/upload-credentials` | `createUploadCredentials` | teacher、parent、admin-pc | **description 里（要人读）** | — |
| POST | `/media/files` | `commitUploadedFile` | teacher、parent、admin-pc | **description 里（要人读）** | — |
| GET | `/media/files/{file_id}/url` | `getFileUrl` | teacher、parent、admin-pc、partner-account | `x-hualong-scope` | — |
| GET | `/library/resources` | `listResources` | teacher、partner-account、admin-pc | **description 里（要人读）** | — |
| GET | `/library/resources/{resource_id}` | `getResource` | teacher、partner-account、admin-pc | **description 里（要人读）** | — |
| POST | `/library/resources/{resource_id}/download-link` | `createResourceDownloadLink` | teacher、partner-account | **description 里（要人读）** | — |
| GET | `/library/cases` | `listCases` | teacher、partner-account、admin-pc | **description 里（要人读）** | — |
| GET | `/library/cases/{case_id}` | `getCase` | teacher、partner-account、admin-pc | **description 里（要人读）** | — |
| POST | `/library/cases/{case_id}/download-link` | `createCaseDownloadLink` | teacher、partner-account | **description 里（要人读）** | — |
| GET | `/growth-book/books/{growth_book_id}/manifest` | `getResolvedBookManifest` | teacher、parent | **description 里（要人读）** | — |
| GET | `/growth-book/books/{growth_book_id}/pages/{ordinal}` | `getBookPage` | teacher、parent | **description 里（要人读）** | — |
| GET | `/moments` | `listMoments` | teacher、parent、admin-pc | `x-hualong-scope` | — |
| GET | `/moments/{moment_id}` | `getMoment` | teacher、parent、admin-pc | `x-hualong-scope` | — |

**同时给教师端与家长端的**：`GET /auth/session`、`DELETE /auth/session`、`POST /media/upload-credentials`、`POST /media/files`、`GET /media/files/{file_id}/url`、`GET /growth-book/books/{growth_book_id}/manifest`、`GET /growth-book/books/{growth_book_id}/pages/{ordinal}`、`GET /moments`、`GET /moments/{moment_id}`。合并客户端之后，这一批是「同一支调用、两种身份」最直接的落点。

---

## 三、范围只写在 description 里的（12 条）

这几条的 `x-hualong-scope` 是空的，逐角色的 predicate 写在散文中。**机器抓不到，人要读。**
给合并客户端做审阅时，这一批至少要逐条读一遍。

| 方法 | 路径 | 角色 | 为什么在这里 |
|---|---|---|---|
| GET | `/auth/session` | teacher、parent、admin-pc、partner-account | 多角色但无 `x-hualong-scope`，范围在 description |
| DELETE | `/auth/session` | teacher、parent、admin-pc、partner-account | 多角色但无 `x-hualong-scope`，范围在 description |
| POST | `/media/upload-credentials` | teacher、parent、admin-pc | 多角色但无 `x-hualong-scope`，范围在 description |
| POST | `/media/files` | teacher、parent、admin-pc | 多角色但无 `x-hualong-scope`，范围在 description |
| GET | `/library/resources` | teacher、partner-account、admin-pc | 多角色但无 `x-hualong-scope`，范围在 description |
| GET | `/library/resources/{resource_id}` | teacher、partner-account、admin-pc | 多角色但无 `x-hualong-scope`，范围在 description |
| POST | `/library/resources/{resource_id}/download-link` | teacher、partner-account | 多角色但无 `x-hualong-scope`，范围在 description |
| GET | `/library/cases` | teacher、partner-account、admin-pc | 多角色但无 `x-hualong-scope`，范围在 description |
| GET | `/library/cases/{case_id}` | teacher、partner-account、admin-pc | 多角色但无 `x-hualong-scope`，范围在 description |
| POST | `/library/cases/{case_id}/download-link` | teacher、partner-account | 多角色但无 `x-hualong-scope`，范围在 description |
| GET | `/growth-book/books/{growth_book_id}/manifest` | teacher、parent | 多角色但无 `x-hualong-scope`，范围在 description |
| GET | `/growth-book/books/{growth_book_id}/pages/{ordinal}` | teacher、parent | 多角色但无 `x-hualong-scope`，范围在 description |

---

## 四、全量清单（167 条）

| 方法 | 路径 | operationId | 角色 | 权限码 | scope | 同路径角色 | 阻断 |
|---|---|---|---|---|---|---|---|
| GET | `/auth/session` | `getSession` | teacher、parent、admin-pc、partner-account | — | （见 description） | teacher、parent、admin-pc、partner-account | — |
| POST | `/auth/session` | `createSession` | 登录前公开 | — | — | teacher、parent、admin-pc、partner-account | G1（仅 surface=parent 与管理端 PC；teacher 可实作） |
| DELETE | `/auth/session` | `revokeSession` | teacher、parent、admin-pc、partner-account | — | （见 description） | teacher、parent、admin-pc、partner-account | — |
| POST | `/media/upload-credentials` | `createUploadCredentials` | teacher、parent、admin-pc | — | （见 description） | teacher、parent、admin-pc | — |
| POST | `/media/files` | `commitUploadedFile` | teacher、parent、admin-pc | — | （见 description） | teacher、parent、admin-pc | — |
| GET | `/media/files/{file_id}/url` | `getFileUrl` | teacher、parent、admin-pc、partner-account | — | `逐请求内联重验 —— teacher 按 class_id，parent 按 db_child.caretakers，partner 按内容 s3 + 规则版本未撤销` | teacher、parent、admin-pc、partner-account | — |
| GET | `/library/resources` | `listResources` | teacher、partner-account、admin-pc | — | （见 description） | teacher、partner-account、admin-pc | — |
| POST | `/library/resources` | `createResource` | teacher | — | — | teacher、partner-account、admin-pc | — |
| GET | `/library/resources/{resource_id}` | `getResource` | teacher、partner-account、admin-pc | — | （见 description） | teacher、partner-account、admin-pc | — |
| PATCH | `/library/resources/{resource_id}` | `updateResourceDraft` | teacher | — | `WHERE resource_id=$1 AND school_id=$ctx_school AND created_by=$ctx_teacher AND resource_status IN ('s1','s4') RETURNING` | teacher、partner-account、admin-pc | — |
| POST | `/library/resources/{resource_id}/submission` | `submitResource` | teacher | — | `WHERE resource_id=$1 AND created_by=$ctx_teacher AND resource_status IN ('s1','s4') RETURNING` | teacher | — |
| POST | `/library/resources/{resource_id}/download-link` | `createResourceDownloadLink` | teacher、partner-account | — | （见 description） | teacher、partner-account | — |
| GET | `/library/cases` | `listCases` | teacher、partner-account、admin-pc | — | （见 description） | teacher、partner-account、admin-pc | — |
| POST | `/library/cases` | `createCase` | teacher | — | — | teacher、partner-account、admin-pc | — |
| GET | `/library/cases/{case_id}` | `getCase` | teacher、partner-account、admin-pc | — | （见 description） | teacher、partner-account、admin-pc | — |
| PATCH | `/library/cases/{case_id}` | `updateCaseDraft` | teacher | — | `WHERE case_id=$1 AND school_id=$ctx_school AND created_by=$ctx_teacher AND case_status IN ('s1','s4') RETURNING` | teacher、partner-account、admin-pc | — |
| POST | `/library/cases/{case_id}/submission` | `submitCase` | teacher | — | `WHERE case_id=$1 AND created_by=$ctx_teacher AND case_status IN ('s1','s4') RETURNING` | teacher | — |
| POST | `/library/cases/{case_id}/download-link` | `createCaseDownloadLink` | teacher、partner-account | — | （见 description） | teacher、partner-account | — |
| GET | `/admin/review/queue` | `listReviewQueue` | admin-pc | `review.resource \| review.case \| review.teacher_profile \| review.training_feedback（按 tab）` | `derived school_id 必须内联进同一条 predicate —— 它是 admin 唯一的范围边界` | admin-pc | — |
| GET | `/admin/review/targets/{target_type}/{target_id}` | `getReviewTarget` | admin-pc | `按 target_type` | — | admin-pc | — |
| POST | `/admin/review/actions` | `createReviewAction` | admin-pc | `content.review（t1/t2）；review.teacher_profile（t3）；review.training_feedback（t4）；t6 任一有效同园管理端身份` | `UPDATE <target> SET status=... WHERE id=$1 AND school_id=$ctx_school AND status='<from>' RETURNING —— 状态前置与 school_id 都内` | admin-pc | — |
| GET | `/admin/review/policies/current` | `getCurrentReviewPolicy` | admin-pc | — | — | admin-pc | — |
| GET | `/admin/org/teachers` | `listOrgTeachers` | admin-pc | `org.read` | `derived school_id 内联；class_id / teacher_id 对 admin 是 free` | admin-pc | — |
| POST | `/admin/org/teachers` | `createOrgTeacher` | admin-pc | `org.teacher.write` | — | admin-pc | — |
| PATCH | `/admin/org/teachers/{teacher_id}` | `updateOrgTeacher` | admin-pc | `org.teacher.write` | — | admin-pc | — |
| POST | `/admin/org/teachers/{teacher_id}/deactivation` | `deactivateOrgTeacher` | admin-pc | `org.teacher.write` | — | admin-pc | — |
| GET | `/teacher-profile` | `getMyTeacherProfile` | teacher | — | `WHERE db_teacher_profile.teacher_id=$ctx_teacher` | teacher | — |
| GET | `/teacher-profile/changes` | `listMyProfileChanges` | teacher | — | `WHERE db_teacher_profile_change.teacher_id=$ctx_teacher` | teacher | — |
| POST | `/teacher-profile/changes` | `submitProfileChange` | teacher | — | — | teacher | — |
| GET | `/admin/org/classes` | `listOrgClasses` | admin-pc | `org.read` | — | admin-pc | — |
| POST | `/admin/org/classes` | `createOrgClass` | admin-pc | `org.class.write` | — | admin-pc | — |
| PATCH | `/admin/org/classes/{class_id}` | `updateOrgClass` | admin-pc | `org.class.write` | — | admin-pc | — |
| GET | `/admin/org/children` | `listOrgChildren` | admin-pc | `org.read` | — | admin-pc | — |
| POST | `/admin/org/children` | `createOrgChild` | admin-pc | `org.child.write` | — | admin-pc | — |
| PATCH | `/admin/org/children/{child_id}` | `updateOrgChild` | admin-pc | `org.child.write` | — | admin-pc | — |
| POST | `/admin/org/children/{child_id}/class-transfer/preview` | `previewChildClassTransfer` | admin-pc | `org.child.write` | — | admin-pc | — |
| POST | `/admin/org/children/{child_id}/class-transfer` | `transferChildClass` | admin-pc | `org.child.write` | — | admin-pc | G44（`g0` 前置无指涉对象；其余部分可实作） |
| POST | `/admin/org/children/{child_id}/leave` | `markChildLeft` | admin-pc | `org.child.write` | — | admin-pc | — |
| GET | `/parent/children/{child_id}/profile-corrections` | `listChildProfileCorrections` | parent | — | `WHERE child_id=$1 AND caretakers @> jsonb_build_array(jsonb_build_object('id', $ctx_parent)) —— 逐请求内联，不缓存` | parent | — |
| POST | `/parent/children/{child_id}/profile-corrections` | `submitChildProfileCorrection` | parent | — | — | parent | — |
| GET | `/admin/growth-book/setting` | `getSchoolBookSetting` | admin-pc | `growth_book.write` | — | admin-pc | — |
| PATCH | `/admin/growth-book/setting` | `saveSchoolBookSettingDraft` | admin-pc | `growth_book.write` | — | admin-pc | — |
| PUT | `/admin/growth-book/assignments/{grade}/{term_season}` | `selectBookTemplateAssignment` | admin-pc | `growth_book.write` | — | admin-pc | — |
| POST | `/admin/growth-book/sections` | `createSchoolBookSection` | admin-pc | `growth_book.write` | — | admin-pc | — |
| PATCH | `/admin/growth-book/sections/{school_book_section_id}` | `updateSchoolBookSection` | admin-pc | `growth_book.write` | — | admin-pc | — |
| DELETE | `/admin/growth-book/sections/{school_book_section_id}` | `deleteSchoolBookSection` | admin-pc | `growth_book.write` | — | admin-pc | — |
| POST | `/admin/growth-book/publication` | `publishSchoolBookSetting` | admin-pc | `growth_book.write` | — | admin-pc | — |
| POST | `/admin/growth-book/withdrawal` | `withdrawSchoolBookSetting` | admin-pc | `growth_book.write` | — | admin-pc | — |
| PUT | `/admin/growth-book/term-message` | `saveTermGrowthBookMessage` | admin-pc | `growth_book.write` | — | admin-pc | — |
| POST | `/teacher/growth-book/compilation` | `ensureCompilation` | teacher | — | — | teacher | — |
| PATCH | `/teacher/growth-book/compilation/{compilation_id}` | `updateCompilation` | teacher | — | — | teacher | — |
| POST | `/teacher/growth-book/compilation/{compilation_id}/lock` | `lockCompilation` | teacher | — | — | teacher | — |
| GET | `/teacher/growth-book/materials` | `listGrowthMaterials` | teacher | — | `WHERE db_growth_material.compilation_id=$ctx_compilation AND db_growth_book_compilation.class_id=$ctx_class` | teacher | — |
| POST | `/teacher/growth-book/materials` | `createGrowthMaterial` | teacher | — | — | teacher | — |
| PATCH | `/teacher/growth-book/materials/topic-assignment` | `assignGrowthMaterialsToTopic` | teacher | — | — | teacher | — |
| DELETE | `/teacher/growth-book/materials/{growth_material_id}` | `deleteGrowthMaterial` | teacher | — | `DELETE ... USING db_growth_book_compilation WHERE growth_material_id=$1 AND class_id=$ctx_class AND term_id=$ctx_term AN` | teacher | — |
| GET | `/teacher/growth-book/time-topics` | `listTimeTopics` | teacher | — | `WHERE db_growth_book_time_topic.compilation_id=$ctx_compilation AND db_growth_book_compilation.class_id=$ctx_class` | teacher | — |
| POST | `/teacher/growth-book/time-topics` | `createTimeTopic` | teacher | — | — | teacher | — |
| PATCH | `/teacher/growth-book/time-topics/{time_topic_id}` | `renameTimeTopic` | teacher | — | `UPDATE ... FROM db_growth_book_compilation WHERE time_topic_id=$1 AND class_id=$ctx_class AND term_id=$ctx_term AND comp` | teacher | — |
| DELETE | `/teacher/growth-book/time-topics/{time_topic_id}` | `deleteTimeTopic` | teacher | — | `清空与删除两句都带 WHERE class_id=$ctx_class AND term_id=$ctx_term AND compilation_status='e1' —— 只给删除那句带的话，别的学期的素材会被清空归类而主题还在。落在` | teacher | — |
| GET | `/teacher/growth-book/sections` | `listBookSections` | teacher | — | `WHERE db_growth_book_section.compilation_id=$ctx_compilation AND db_growth_book_compilation.class_id=$ctx_class` | teacher | — |
| POST | `/teacher/growth-book/sections` | `createBookSection` | teacher | — | — | teacher | — |
| PATCH | `/teacher/growth-book/sections/{section_id}` | `updateBookSection` | teacher | — | — | teacher | — |
| DELETE | `/teacher/growth-book/sections/{section_id}` | `deleteBookSection` | teacher | — | — | teacher | — |
| PUT | `/teacher/growth-book/sections/{section_id}/widgets` | `saveBookWidgets` | teacher | — | — | teacher | — |
| POST | `/teacher/growth-book/sections/{section_id}/publication` | `publishBookSection` | teacher | — | — | teacher | — |
| POST | `/teacher/growth-book/sections/{section_id}/collection` | `startCollection` | teacher | — | — | teacher | — |
| DELETE | `/teacher/growth-book/sections/{section_id}/collection` | `withdrawCollection` | teacher | — | — | teacher | — |
| POST | `/teacher/growth-book/sections/{section_id}/reminders` | `remindSectionCollection` | teacher | — | — | teacher | — |
| POST | `/teacher/growth-book/books` | `ensureGrowthBook` | teacher | — | — | teacher | — |
| GET | `/teacher/growth-book/precheck` | `precheckClassBooks` | teacher | — | — | teacher | G93（total_pages／section_pages／publishable 要 composer，0/12 released layout pack；其余部分可实作） |
| POST | `/teacher/growth-book/books/{growth_book_id}/publication` | `publishGrowthBook` | teacher | — | — | teacher | — |
| GET | `/growth-book/books/{growth_book_id}/manifest` | `getResolvedBookManifest` | teacher、parent | — | （见 description） | teacher、parent | 0/12 released layout pack —— 端点可实作，但没有 pack 可解析（ADR-0015 Follow-ups） |
| GET | `/growth-book/books/{growth_book_id}/pages/{ordinal}` | `getBookPage` | teacher、parent | — | （见 description） | teacher、parent | 0/12 released layout pack；派生尺寸的 CI 步骤亦待第一份 pack 到件 |
| PUT | `/parent/growth-book/sections/{section_id}/submissions` | `autosaveBookMaterial` | parent | — | `caretakers @> [{id:$ctx_parent}] 内联；widget 必须属于本 section；section d2 且 collection c2` | parent | — |
| GET | `/moments` | `listMoments` | teacher、parent、admin-pc | — | `见上表；teacher 的 class_id 与 parent 的 child_id→class_id 均内联，不先查后做` | teacher、parent、admin-pc | — |
| POST | `/moments` | `publishMoment` | teacher | — | `school_id/class_id/teacher_id 全部 derived；child_id 以 class_id=$ctx_class 内联重验` | teacher、parent、admin-pc | — |
| GET | `/moments/weekly-coverage` | `getMomentWeeklyCoverage` | teacher | — | `class_id=$ctx_class AND enrollment_status='e1' 内联` | teacher | — |
| GET | `/moments/{moment_id}` | `getMoment` | teacher、parent、admin-pc | — | `同 listMoments 的三条 predicate` | teacher、parent、admin-pc | — |
| DELETE | `/moments/{moment_id}` | `deleteMoment` | teacher | — | `DELETE … WHERE moment_id=$1 AND class_id=$ctx_class AND teacher_id=$ctx_teacher；学期与 review_action 前置内联，不先查后删` | teacher、parent、admin-pc | — |
| POST | `/admin/review/moment-actions` | `createMomentReviewAction` | admin-pc | — | `UPDATE db_moment … WHERE moment_id=$1 AND school_id=$ctx_school AND publish_status=<from> RETURNING moment_id —— 零行即前置不满` | admin-pc | — |
| GET | `/home-school/progress` | `getTeacherHomeSchoolProgress` | teacher | — | `child.school_id=$ctx_school AND child.class_id=$ctx_class AND enrollment_status='e1' 内联；活动与任务同班` | teacher | — |
| GET | `/home-school/parent-tasks` | `listParentTasks` | teacher | — | `school_id = $ctx_school AND class_id = $ctx_class` | teacher | — |
| POST | `/home-school/parent-tasks` | `createParentTask` | teacher | — | — | teacher | — |
| GET | `/home-school/parent-tasks/{parent_task_id}` | `getParentTask` | teacher | — | `parent_task_id = $1 AND school_id = $ctx_school AND class_id = $ctx_class` | teacher | — |
| PATCH | `/home-school/parent-tasks/{parent_task_id}` | `updateParentTaskDraft` | teacher | — | — | teacher | — |
| POST | `/home-school/parent-tasks/{parent_task_id}/publication` | `publishParentTask` | teacher | — | — | teacher | — |
| POST | `/home-school/parent-tasks/{parent_task_id}/closure` | `closeParentTask` | teacher | — | — | teacher | — |
| GET | `/home-school/parent-tasks/{parent_task_id}/submissions` | `listParentTaskSubmissions` | teacher | — | `parent_task_id = $1 AND class_id = $ctx_class（幼儿名单同 predicate 取自本班 e1）` | teacher | — |
| GET | `/home-school/community-feed` | `listCommunityFeed` | teacher | — | `parent_task.school_id = $ctx_school AND parent_task.class_id = $ctx_class AND parent_task.publish_status IN ('s2','s3') ` | teacher | — |
| GET | `/home-school/parent-evaluations` | `listParentEvaluationsForTeacher` | teacher | — | `school_id = $ctx_school AND class_id = $ctx_class` | teacher | — |
| POST | `/home-school/parent-evaluations` | `openParentEvaluationWindow` | teacher | — | `school_id = $ctx_school AND class_id = $ctx_class AND child.enrollment_status = 'e1'` | teacher | — |
| GET | `/home-school/parent-evaluations/{parent_evaluation_id}` | `getParentEvaluationForTeacher` | teacher | — | `school_id = $ctx_school AND class_id = $ctx_class AND parent_evaluation_id = $1` | teacher | — |
| GET | `/home-school/month-evals` | `listMonthEvals` | teacher | — | `teacher_id = $ctx_teacher AND class_id = $ctx_class` | teacher | — |
| PUT | `/home-school/month-evals` | `saveMonthEvalDraft` | teacher | — | — | teacher | — |
| POST | `/home-school/month-evals/{month_eval_id}/publication` | `publishMonthEval` | teacher | — | — | teacher | — |
| GET | `/parent/children/{child_id}/parent-tasks` | `listParentTasksForChild` | parent | — | `caretakers @> [{id: $ctx_parent}] AND publish_status IN ('s2','s3')` | parent | — |
| GET | `/parent/children/{child_id}/parent-tasks/{parent_task_id}` | `getParentTaskForChild` | parent | — | `caretakers @> [{id: $ctx_parent}] AND parent_task.class_id = child.class_id` | parent | — |
| PUT | `/parent/children/{child_id}/parent-tasks/{parent_task_id}/submission` | `saveParentTaskSubmissionDraft` | parent | — | — | parent | — |
| POST | `/parent/children/{child_id}/parent-tasks/{parent_task_id}/submission/content-check` | `submitParentTaskSubmission` | parent | — | — | parent | — |
| PUT | `/parent/children/{child_id}/parent-tasks/{parent_task_id}/submission/book-inclusion` | `setParentBookInclusion` | parent | — | `caretakers @> [{id: $ctx_parent}] AND submission_status = 'c1'` | parent | — |
| PUT | `/teacher/growth-book/task-submissions/{parent_task_submission_id}/inclusion` | `setTeacherBookInclusion` | teacher | — | `parent_task_submission_id = $1 AND parent_task.class_id = $ctx_class AND submission_status = 'c1'` | teacher | — |
| PUT | `/parent/children/{child_id}/parent-tasks/{parent_task_id}/read-receipt` | `markParentTaskRead` | parent | — | `caretakers @> [{id: $ctx_parent}] AND parent_task.publish_status IN ('s2','s3')` | parent | — |
| GET | `/parent/children/{child_id}/task-submissions` | `listChildTaskSubmissions` | parent | — | `caretakers @> [{id: $ctx_parent}] AND submission_status = 'c1' AND parent_task.term_id = $term` | parent | — |
| GET | `/parent/children/{child_id}/evaluations` | `listChildEvaluations` | parent | — | `caretakers @> [{id: $ctx_parent}]` | parent | — |
| GET | `/parent/children/{child_id}/evaluations/{parent_evaluation_id}` | `getChildEvaluation` | parent | — | `caretakers @> [{id: $ctx_parent}] AND parent_evaluation_id = $1` | parent | — |
| PUT | `/parent/children/{child_id}/evaluations/{parent_evaluation_id}` | `saveChildEvaluationDraft` | parent | — | — | parent | — |
| POST | `/parent/children/{child_id}/evaluations/{parent_evaluation_id}/content-check` | `submitChildEvaluation` | parent | — | — | parent | — |
| GET | `/parent/children/{child_id}/evaluations/{parent_evaluation_id}/photo-sources` | `listEvaluationPhotoSources` | parent | — | `caretakers @> [{id: $ctx_parent}] AND submission_status = 'c1'` | parent | — |
| PUT | `/parent/children/{child_id}/evaluations/{parent_evaluation_id}/read-receipt` | `markParentEvaluationRead` | parent | — | `caretakers @> [{id: $ctx_parent}] AND parent_evaluation_id = $1` | parent | — |
| GET | `/admin/home-school/progress` | `getAdminHomeSchoolProgress` | admin-pc | `home_school_data.read` | `school_id = $ctx_school` | admin-pc | — |
| GET | `/party/home` | `getPartyHome` | teacher | — | `school_id = $ctx_school AND *_status = 's3'` | teacher | — |
| GET | `/party/studies` | `listPartyStudies` | teacher | — | `school_id = $ctx_school AND study_status = 's3'` | teacher | — |
| GET | `/party/studies/{study_id}` | `getPartyStudy` | teacher | — | `WHERE study_id=$1 AND school_id=$ctx_school AND study_status='s3'` | teacher | — |
| GET | `/party/activities` | `listPartyActivities` | teacher | — | `school_id = $ctx_school AND activity_status = 's3'` | teacher | — |
| GET | `/party/activities/{activity_id}` | `getPartyActivity` | teacher | — | `WHERE activity_id=$1 AND school_id=$ctx_school AND activity_status='s3'` | teacher | — |
| GET | `/party/brands` | `listPartyBrands` | teacher | — | `school_id = $ctx_school AND brand_status = 's3'` | teacher | — |
| GET | `/party/brands/{brand_id}` | `getPartyBrand` | teacher | — | `WHERE brand_id=$1 AND school_id=$ctx_school AND brand_status='s3'` | teacher | — |
| GET | `/coordination/documents` | `listCoordDocuments` | teacher | — | `school_id = $ctx_school AND document_status = 's3'` | teacher | — |
| GET | `/coordination/documents/{document_id}` | `getCoordDocument` | teacher | — | `WHERE document_id=$1 AND school_id=$ctx_school AND document_status='s3'` | teacher | — |
| GET | `/trainings` | `listTrainings` | teacher | — | `school_id = $ctx_school AND training_status = 's1'` | teacher | — |
| GET | `/trainings/{training_id}` | `getTraining` | teacher | — | `WHERE training_id=$1 AND school_id=$ctx_school AND training_status IN ('s1','s5')` | teacher | — |
| POST | `/trainings/{training_id}/registration` | `registerForTraining` | teacher | — | `WHERE training_id=$1 AND teacher_id=$ctx_teacher AND $now < start_at RETURNING` | teacher | — |
| POST | `/trainings/{training_id}/registration-cancellation` | `cancelTrainingRegistration` | teacher | — | `WHERE training_id=$1 AND teacher_id=$ctx_teacher AND participation_status='s1' AND $now < start_at RETURNING` | teacher | — |
| GET | `/training-participations` | `listMyTrainingParticipations` | teacher | — | `teacher_id = $ctx_teacher` | teacher | — |
| GET | `/trainings/{training_id}/feedback` | `listTrainingFeedback` | teacher | — | `training_id=$1 AND school_id=$ctx_school AND feedback_status='s3' AND db_training.training_status='s1'` | teacher | — |
| POST | `/trainings/{training_id}/feedback` | `submitTrainingFeedback` | teacher | — | `WHERE training_id=$1 AND teacher_id=$ctx_teacher AND participation_status='s3' AND $now > effective_end_at` | teacher | — |
| GET | `/tasks` | `listMyTasks` | teacher | — | `db_task_assign.teacher_id = $ctx_teacher AND db_task.school_id = $ctx_school` | teacher | — |
| GET | `/tasks/{task_id}` | `getTask` | teacher | — | `WHERE task_id=$1 AND school_id=$ctx_school AND EXISTS(assign WHERE teacher_id=$ctx_teacher)` | teacher | — |
| POST | `/tasks/{task_id}/acceptance` | `acceptTaskAssignment` | teacher | — | `WHERE task_id=$1 AND teacher_id=$ctx_teacher AND assign_status='a1' AND EXISTS(SELECT 1 FROM db_task WHERE task_id=$1 AN` | teacher | — |
| POST | `/tasks/{task_id}/completion` | `completeTaskAssignment` | teacher | — | `WHERE task_id=$1 AND teacher_id=$ctx_teacher AND assign_status='a2' AND EXISTS(SELECT 1 FROM db_task WHERE task_id=$1 AN` | teacher | — |
| POST | `/admin/content/party-studies` | `publishPartyStudy` | admin-pc | `content.party.write` | — | admin-pc | — |
| POST | `/admin/content/party-studies/{study_id}/withdrawal` | `withdrawPartyStudy` | admin-pc | `content.party.write` | `WHERE study_id=$1 AND school_id=$ctx_school AND study_status='s3' RETURNING` | admin-pc | — |
| POST | `/admin/content/party-activities` | `publishPartyActivity` | admin-pc | `content.party.write` | — | admin-pc | — |
| POST | `/admin/content/party-activities/{activity_id}/withdrawal` | `withdrawPartyActivity` | admin-pc | `content.party.write` | `WHERE activity_id=$1 AND school_id=$ctx_school AND activity_status='s3' RETURNING` | admin-pc | — |
| POST | `/admin/content/party-brands` | `publishPartyBrand` | admin-pc | `content.party.write` | — | admin-pc | — |
| POST | `/admin/content/party-brands/{brand_id}/withdrawal` | `withdrawPartyBrand` | admin-pc | `content.party.write` | `WHERE brand_id=$1 AND school_id=$ctx_school AND brand_status='s3' RETURNING` | admin-pc | — |
| POST | `/admin/content/coordination-documents` | `createCoordDocument` | admin-pc | `content.coord.write` | — | admin-pc | — |
| PATCH | `/admin/content/coordination-documents/{document_id}` | `updateCoordDocumentDraft` | admin-pc | `content.coord.write` | `WHERE document_id=$1 AND school_id=$ctx_school AND document_status='s1' RETURNING` | admin-pc | — |
| POST | `/admin/content/coordination-documents/{document_id}/publication` | `publishCoordDocumentDraft` | admin-pc | `content.coord.write` | `WHERE document_id=$1 AND school_id=$ctx_school AND document_status='s1' RETURNING` | admin-pc | — |
| POST | `/admin/content/coordination-documents/{document_id}/withdrawal` | `withdrawCoordDocument` | admin-pc | `content.coord.write` | `WHERE document_id=$1 AND school_id=$ctx_school AND document_status='s3' RETURNING` | admin-pc | — |
| POST | `/admin/content/trainings` | `createTraining` | admin-pc | `content.training.write` | — | admin-pc | — |
| PATCH | `/admin/content/trainings/{training_id}` | `updateTrainingDraft` | admin-pc | `content.training.write` | `WHERE training_id=$1 AND school_id=$ctx_school AND training_status='s0' RETURNING` | admin-pc | — |
| POST | `/admin/content/trainings/{training_id}/publication` | `publishTrainingDraft` | admin-pc | `content.training.write` | `WHERE training_id=$1 AND school_id=$ctx_school AND training_status='s0' RETURNING` | admin-pc | — |
| POST | `/admin/content/trainings/{training_id}/withdrawal` | `withdrawTraining` | admin-pc | `content.training.write` | `WHERE training_id=$1 AND school_id=$ctx_school AND training_status='s1' RETURNING` | admin-pc | — |
| POST | `/admin/tasks` | `publishTask` | admin-pc | `task.publish` | — | admin-pc | — |
| POST | `/admin/tasks/{task_id}/reminder` | `urgeTaskAssignees` | admin-pc | `task.urge` | `WHERE task_id=$1 AND school_id=$ctx_school AND task_status IN ('t1','t2')` | admin-pc | — |
| POST | `/admin/tasks/{task_id}/completion` | `completeTask` | admin-pc | `task.publish` | `WHERE task_id=$1 AND school_id=$ctx_school AND task_status IN ('t1','t2') RETURNING` | admin-pc | — |
| POST | `/admin/tasks/{task_id}/cancellation` | `cancelTask` | admin-pc | `task.publish` | `WHERE task_id=$1 AND school_id=$ctx_school AND task_status IN ('t1','t2') RETURNING` | admin-pc | — |
| GET | `/teacher-messages` | `listTeacherMessages` | teacher | — | `WHERE db_child.class_id=$ctx_class AND db_child.enrollment_status='e1'` | teacher | — |
| POST | `/teacher-messages` | `submitTeacherMessagesForClass` | teacher | — | `INSERT … SELECT ch.child_id FROM db_child ch WHERE ch.class_id=$ctx_class AND ch.enrollment_status='e1' AND NOT EXISTS (` | teacher | — |
| GET | `/children/{child_id}/teacher-message` | `getTeacherMessage` | teacher | — | `WHERE child_id=$1 AND term_id=$current_term AND child_id IN (SELECT child_id FROM db_child WHERE class_id=$ctx_class AND` | teacher | — |
| PUT | `/children/{child_id}/teacher-message` | `submitTeacherMessage` | teacher | — | `INSERT … WHERE EXISTS (SELECT 1 FROM db_child WHERE child_id=$1 AND class_id=$ctx_class AND enrollment_status='e1') AND ` | teacher | — |
| GET | `/term-evaluations` | `listTermEvaluations` | teacher | — | `WHERE db_child.class_id=$ctx_class AND db_child.enrollment_status='e1'` | teacher | — |
| GET | `/children/{child_id}/term-evaluation` | `getTermEvaluation` | teacher | — | `WHERE child_id=$1 AND teacher_id=$ctx_teacher AND term_id=$current_term AND child_id IN (SELECT child_id FROM db_child W` | teacher | — |
| PUT | `/children/{child_id}/term-evaluation` | `submitTermEvaluation` | teacher | — | `INSERT … WHERE EXISTS (SELECT 1 FROM db_child WHERE child_id=$1 AND class_id=$ctx_class AND enrollment_status='e1') RETU` | teacher | — |
| GET | `/child-assessments` | `listChildAssessments` | teacher | — | `WHERE db_child.class_id=$ctx_class AND db_child.enrollment_status='e1'` | teacher | — |
| GET | `/child-assessments/class-report` | `getChildAssessmentClassReport` | teacher | — | `WHERE class_id=$ctx_class AND term_id=$current_term AND child_assessment_status='c1'` | teacher | — |
| GET | `/children/{child_id}/child-assessment` | `getChildAssessment` | teacher | — | `WHERE child_id=$1 AND term_id=$current_term AND class_id=$ctx_class` | teacher | — |
| PUT | `/children/{child_id}/child-assessment/items/{item_id}` | `scoreChildAssessmentItem` | teacher | — | `WHERE child_id=$1 AND class_id=$ctx_class AND enrollment_status='e1' AND term_id=$current_term` | teacher | — |
| GET | `/children/{child_id}/child-assessment/report` | `getChildAssessmentReport` | teacher | — | `WHERE child_id=$1 AND class_id=$ctx_class AND term_id=$current_term` | teacher | — |
| GET | `/scales/{scale_code}/{scale_version}` | `getScale` | teacher | — | — | teacher | — |
| GET | `/growth-records` | `listGrowthRecords` | teacher | — | `WHERE class_id=$ctx_class AND term_id=$current_term` | teacher | — |
| GET | `/children/{child_id}/growth-record` | `getGrowthRecord` | teacher | — | `WHERE child_id=$1 AND class_id=$ctx_class AND term_id=$current_term` | teacher | — |
| GET | `/assessments` | `listAssessments` | teacher | — | `WHERE school_id=$ctx_school AND teacher_id=$ctx_teacher` | teacher | — |
| GET | `/assessments/{assessment_id}` | `getAssessment` | teacher | — | `WHERE assessment_id=$1 AND school_id=$ctx_school AND teacher_id=$ctx_teacher` | teacher | — |
| PUT | `/assessments/{assessment_id}/items/{tool_item_code}` | `scoreAssessmentItem` | teacher | — | `WHERE assessment_id=$1 AND school_id=$ctx_school AND teacher_id=$ctx_teacher RETURNING` | teacher | — |

---

## 五、这张表**不能**回答的

- **谁有权限调**：它只列契约**声明**的角色；服务端实作是否会漏判，要靠
  `db/testdata/authz-tests/` 那七组越权探针，不是靠这张表。
- **合并客户端后「一个人两种角色」怎么办**：那是一条**身份模型决议**，不是契约改动。
  契约今天的前提写在 `DECISIONS.md` A1/A2：**两个小程序、两个 AppID，角色由「开哪个 app」决定，
  不做角色切换**；而 `db/GAPS.md` **G1** 登记着这个模型仍缺 DDL（`db_phone_claim` 的
  `ck_pc2_type` 今天只允许 c1/c5，所以 `surface=parent` 实作不出来）。
  **要合并端，先改的是那两处，不是这份契约。**
- **范围判定是否真的生效**：见 `/pages` 与 authz 探针。
