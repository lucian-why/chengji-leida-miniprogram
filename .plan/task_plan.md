# 成绩雷达 Code Review 分块计划

## Goal

分块完成成绩雷达小程序整体 Code Review，优先发现并修复数据丢失、账号/VIP、云同步、AI 成本、异常输入等上线风险。

## Current Status

- 当前阶段：Phase 5 AI 配额服务端轻量修复已部署
- 执行模式：分块 Review，发现 P1/P2 后由用户确认再修
- 已部署修复：短信官方 Auth、admin 云端鉴权、TOKEN_SALT、syncOfficialUser、redeemVipCode token 鉴权

## Phases

| Phase | Status | Scope | Output |
|---|---|---|---|
| Phase 0 | complete | 项目地图与云函数矩阵 | 已补齐云函数配置和源码 |
| Phase 1 | complete | 账号/短信/admin/token | 已修并部署 |
| Phase 2 | complete | VIP 兑换兼容手机号/邮箱 | 已修并部署 |
| Phase 3 | complete | 云同步与数据生命周期 | 已修并提交 `54ca2ff` |
| Phase 4 | complete | 成绩计算、图表、报告 | 已修并提交 `46add6b` |
| Phase 5 | complete | AI 配额与服务端成本控制 | P1 轻量修复已部署；P2 输入限制待确认 |
| Phase 6 | pending | 最小手测清单与最终报告 | 待整理 |

## Phase 3 Review Targets

- `utils/cloudSync.js`
- `utils/autoSync.js`
- `modules/profileModule.js`
- `cloudfunctions/listCloudProfiles/index.js`
- `cloudfunctions/uploadCloudProfile/index.js`
- `cloudfunctions/getCloudProfileData/index.js`
- `cloudfunctions/deleteCloudProfiles/index.js`
- `cloudfunctions/restoreCloudProfiles/index.js`
- `cloudfunctions/purgeDeletedProfiles/index.js`

## Phase 3 Questions

1. 未登录录入成绩后登录，档案是否正确归属。
2. 微信/邮箱/手机号登录后，云端 userId 是否一致。
3. 多账号切换是否会串档。
4. 上传/下载/删除/恢复是否都验证 token + userId。
5. 云端覆盖本地是否有误覆盖/丢数据风险。
6. 断网、超时、云函数失败是否不会卡死。
7. 回收站恢复是否需要服务端 VIP 校验。

## Phase 4 Review Targets

- `utils/format.js`
- `utils/chart.js`
- `utils/report.js`
- `modules/examModule.js`
- `modules/scoreModule.js`
- `modules/batchModule.js`
- `modules/chartModule.js`
- `modules/reportModule.js`
- `modules/dataManager.js`

## Phase 4 Questions

1. 手动总分与自动总分切换是否会造成显示/图表/报告不一致。
2. `excluded` 排除统计是否在趋势图、雷达图、AI、报告里一致。
3. 空科目、缺考、满分为 0、异常排名是否会崩溃。
4. 趋势图/雷达图 canvas 在空数据、极端数据、长科目名下是否稳定。
5. 报告生成对空档案、空考试、隐藏考试是否稳定。

## Phase 5 Review Targets

- `utils/ai.js`
- `utils/vip.js`
- `cloudfunctions/ai_service/index.js`
- `cloudfunctions/ai_service/package.json`
- AI 相关页面入口与云函数调用链

## Phase 5 Questions

1. 免费用户每日 AI 分析/对话次数是否可被清缓存或改包绕过。
2. VIP 隐藏防刷限额是否有服务端保护。
3. AI 请求超时/失败是否稳定降级，不黑屏不卡 loading。
4. AI 云函数是否校验 token/userId/action/payload 尺寸。
5. 是否存在成本失控入口：未登录、直接调用云函数、超大输入、循环调用。

## Errors Encountered

| Time | Error | Resolution |
|---|---|---|
| 2026-04-21 | `rg` 不可用/Access denied | 使用 PowerShell `Get-ChildItem` + `Select-String` |
| 2026-04-21 | PowerShell `RandomNumberGenerator.Fill` 不存在 | 改用 `RNGCryptoServiceProvider` 生成 `TOKEN_SALT` |
