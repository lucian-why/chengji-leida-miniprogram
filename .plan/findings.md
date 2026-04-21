# Code Review Findings Log

## Resolved Findings

### 云函数配置不完整

- Impact: 新环境部署/迁移会漏登录与云同步函数。
- Fix: 补齐 `cloudbaserc.json`，将云函数源码纳入 `cloudfunctions/`，只忽略 `node_modules`。
- Commit: `b72dde9`

### 前端硬编码 admin 密码

- Impact: 小程序包可反编译拿到 admin 密码。
- Fix: 新增 `adminLogin` 云函数，前端不再保存密码。
- Commit: `b72dde9`

### TOKEN_SALT 默认值

- Impact: 自建 token 可预测，安全边界弱。
- Fix: 配置 `TOKEN_SALT` 环境变量，代码缺失时 fail fast。
- Commit: `b72dde9`

### 手机官方 Auth 与旧 users 体系割裂

- Impact: 手机号用户无法继承 VIP、云档案、兑换码状态。
- Fix: 新增 `syncOfficialUser` 映射官方 Auth 用户到旧 `users`。
- Commit: `b72dde9`

### VIP 兑换只支持微信 openid

- Impact: 手机号/邮箱用户无法兑换 VIP。
- Fix: `redeemVipCode` 支持 `token + userId` 鉴权，保留微信 fallback。
- Commit: `2a93567`

## Open Findings

### AI 配额只在前端本地校验

- File: `cloudfunctions/ai_service/index.js`
- Priority: P1
- Current decision: 暂缓。用户关心响应速度，先不修。

### 回收站恢复只靠前端 VIP 拦截

- File: `cloudfunctions/restoreCloudProfiles/index.js`
- Priority: P1
- Current decision: 后续云同步块继续评估。

## Phase 3 Findings

待补充。


## Phase 3 Findings - Cloud Sync & Data Lifecycle

### P1 Existing local profiles can miss newer cloud changes
- File: `utils/autoSync.js`, `utils/storage.js`
- Evidence: `autoSync.performFullSync()` compares cloud `lastSyncAt` with `localProfile.bundle.exportedAt`; `getLocalProfileBundle()` always sets `exportedAt` to current time when called.
- Impact: On device B, calling sync now makes localTime "now", so cloud changes from device A usually look older and are not downloaded. Multi-device sync silently misses updates.
- Suggested fix: persist real local `updatedAt`/`lastModifiedAt` on profile/exam changes, or keep per-profile sync metadata; compare cloud time against real local modification time, not export time.

### P1 Orphan archive deletes local data before cloud upload succeeds
- File: `utils/cloudSync.js`, `utils/storage.js`
- Evidence: `archiveOrphanProfiles()` first calls `storage.removeOrphanProfiles()`, which deletes profiles/exams/form memory locally, then uploads bundles one by one. Upload failures are caught and only logged.
- Impact: If network/function fails after local deletion, user choosing "移入回收站" can lose local data without it reaching cloud recycle bin.
- Suggested fix: collect orphan bundles without deleting, upload all successfully, then remove local; if partial failure, keep failed profiles locally or restore from captured bundles.

### P1 Recycle-bin restore still lacks server-side VIP check
- File: `cloudfunctions/restoreCloudProfiles/index.js`
- Evidence: Frontend calls `vip.checkLimit('recycleBinRestore')`, but cloud function only checks token+userId and updates deleted=false.
- Impact: Non-VIP users can bypass frontend and call function directly to restore.
- Suggested fix: after auth, query `users` role/vipExpireAt and reject non-VIP before update.

## Phase 3 Fixes Applied

### Fixed: Existing local profiles can miss newer cloud changes
- Files: `utils/storage.js`, `utils/autoSync.js`
- Change: Added real profile/exam `updatedAt` tracking and `localUpdatedAt` in local bundles; auto sync now compares cloud `lastSyncAt` with `localUpdatedAt` instead of transient `exportedAt`.
- Verification: `node --check` and mock storage invariant test passed.

### Fixed: Orphan archive deletes local data before cloud upload succeeds
- Files: `utils/storage.js`, `utils/cloudSync.js`
- Change: Added read-only `getOrphanProfileBundles()` and explicit `removeProfilesByIds()`; archive uploads all bundles first and deletes local data only after all uploads succeed. Partial failure throws and preserves local data.
- Verification: `node --check` and mock storage invariant test passed.

### Deferred: Recycle-bin restore still lacks server-side VIP check
- File: `cloudfunctions/restoreCloudProfiles/index.js`
- Current decision: User said third item not needed now; keep open/deferred.

## Phase 4 Findings - Score, Chart, Report

### P2 AI chat summary ignores manual total score when value is 0
- File: `utils/ai.js`
- Evidence: Chat prompt uses `exam.manualTotalScore || autoSum`, while display/report helpers use explicit null/undefined checks.
- Impact: If user manually sets total score to 0, AI chat summary sends auto-calculated total instead. This is inconsistent with page display and reports.
- Suggested fix: use `fmt.getDisplayTotalScore(exam)` or same nullish semantics as `getManualTotalScore()`.

### P3 Missing fullScore renders `--%` in score/report UI
- Files: `pages/index/index.wxml`, `utils/report.js`
- Evidence: WXS `getRate()` returns `--` when `fullScore` is missing, but template appends `%`; report also formats `${latestPct}%` even when `toPercent()` returns `--`.
- Impact: Old/cloud data with missing `fullScore` does not crash, but UI shows `--%`, which looks unpolished.
- Suggested fix: return display-ready percent text from helper or only append `%` for numeric values.

## Phase 4 Fixes Applied

### Fixed: AI chat summary ignores manual total score when value is 0
- File: `utils/ai.js`
- Change: Chat summary now uses `getDisplayTotalScore(exam)`, matching page and report semantics.
- Verification: `node --check utils/ai.js`; manual-total-zero helper test passed.

### Fixed: Missing fullScore renders `--%` in score/report UI
- Files: `pages/index/index.wxml`, `utils/report.js`
- Change: Score card percent helper now returns display-ready text; report formats `--` without appending `%`.
- Verification: `node --check utils/report.js`; page JS syntax check passed.
