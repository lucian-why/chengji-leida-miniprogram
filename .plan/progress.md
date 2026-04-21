# Progress Log

## 2026-04-21

- 启用 `planning-with-files` 工作流。
- 初始化 `.plan/task_plan.md`、`.plan/findings.md`、`.plan/progress.md`。
- 当前进入 Phase 3：云同步与数据生命周期 Review。


- Phase 3 read pass: checked utils/cloudSync.js, utils/autoSync.js, modules/profileModule.js.
- Early risk: auto sync compares cloud lastSyncAt against local bundle exportedAt; need verify storage export timestamp semantics before filing finding.

- Phase 3 completed read review. Added 3 findings: sync timestamp bug, orphan archive data-loss risk, recycle restore server VIP gap.

- Implemented Phase 3 fix 1: `utils/storage.js` now tracks real `updatedAt`/`localUpdatedAt`; `utils/autoSync.js` compares cloud `lastSyncAt` against real local update time.
- Implemented Phase 3 fix 2: `utils/cloudSync.js` orphan archive now uploads first, deletes local profiles only after all uploads succeed.
- Verification: `node --check` passed for changed storage/sync files and main frontend modules; mock storage invariant test passed.

- Refined sync fix: added profile lastCloudSyncAt marker after upload/download so devices remember the cloud version already seen and avoid repeated download loops.

- Fixed runtime error from device B login: removed file-level _modulesRegistered guard in pages/index/index.js; module mixins now register per page instance so _refreshCurrentExam exists after page recreation.

- Fixed cross-device delete sync gap: autoSync now reads deleted cloud profiles first, removes matching local profiles when cloud delete is newer, and skips re-uploading cloud-deleted profiles in the same sync.

- Entered Phase 4: score calculation, chart, report review. Scope is read-only review unless user confirms fixes.

- Phase 4 read review completed. No P1 crash/data-loss issue found in score/chart/report core. Logged P2 AI manual-total consistency issue and P3 missing-fullScore display polish issue.

- Fixed Phase 4 P3 display polish: missing fullScore now shows -- instead of --% in score view and reports.

- Phase 4 fixes committed and pushed as 46add6b. Entered Phase 5: AI quota and server-side cost control review.

- Phase 5 read review completed. Added findings for missing server-side AI auth/quota, missing payload size caps, and raw AI event logging. Timeout/fallback path looks acceptable.

- Implemented Phase 5 P1 lightweight fix: cloud-function AI fallback now sends token/userId; ai_service validates login and records daily quota in ai_usage. Deployed ai_service and verified empty invoke returns 401 instead of running.
