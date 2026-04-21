# 成绩雷达 Code Review 分块计划

## Goal

分块完成成绩雷达小程序整体 Code Review，优先发现并修复数据丢失、账号/VIP、云同步、AI 成本、异常输入等上线风险。

## Current Status

- 当前阶段：Phase 3 云同步与数据生命周期 Review
- 执行模式：分块 Review，发现 P1/P2 后由用户确认再修
- 已部署修复：短信官方 Auth、admin 云端鉴权、TOKEN_SALT、syncOfficialUser、redeemVipCode token 鉴权

## Phases

| Phase | Status | Scope | Output |
|---|---|---|---|
| Phase 0 | complete | 项目地图与云函数矩阵 | 已补齐云函数配置和源码 |
| Phase 1 | complete | 账号/短信/admin/token | 已修并部署 |
| Phase 2 | complete | VIP 兑换兼容手机号/邮箱 | 已修并部署 |
| Phase 3 | in_progress | 云同步与数据生命周期 | 待产出 findings |
| Phase 4 | pending | 成绩计算、图表、报告 | 待审 |
| Phase 5 | pending | AI 配额与服务端成本控制 | 待审 |
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

## Errors Encountered

| Time | Error | Resolution |
|---|---|---|
| 2026-04-21 | `rg` 不可用/Access denied | 使用 PowerShell `Get-ChildItem` + `Select-String` |
| 2026-04-21 | PowerShell `RandomNumberGenerator.Fill` 不存在 | 改用 `RNGCryptoServiceProvider` 生成 `TOKEN_SALT` |

