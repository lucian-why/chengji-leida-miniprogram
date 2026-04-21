# 成绩雷达小程序 Code Review 规划

## 目标

对成绩雷达小程序做一轮面向上线稳定性的整体 Code Review，重点覆盖数据安全、账号/VIP、云同步、成绩计算、AI 成本控制、异常输入和小程序黑屏卡死风险。

本轮 Review 不只看代码风格，优先找会造成数据丢失、付费绕过、核心功能不可用、用户体验中断的问题。发现 P1/P2 级问题后，可按用户确认逐项修复、部署、提交 GitHub。

## 当前项目形态

- 主入口：`pages/index/index`
- AI 对话分包：`pages/ai-chat/ai-chat`
- 前端核心模块：`modules/`
- 通用工具：`utils/`
- 云函数：`cloudfunctions/`
- 云函数配置：`cloudbaserc.json`
- 测试参照：`小程序主要功能测试SOP.md`

## 已完成的基础修复

- 手机短信验证码改为 CloudBase 官方默认短信渠道。
- 删除旧 `sendSmsCode` 云函数配置和本地源码。
- 补齐 `cloudbaserc.json` 中实际被前端调用的云函数。
- 将线上云函数源码纳入本地仓库，`node_modules` 继续忽略。
- 移除前端硬编码 admin 密码，改为 `adminLogin` 云函数校验。
- 配置并部署 `TOKEN_SALT`，移除 token 默认 salt。
- 新增 `syncOfficialUser`，让手机号官方 Auth 用户映射回旧 `users` 体系。
- 修复手机号/邮箱用户兑换 VIP 的兼容问题。
- 增加成绩、满分、排名、总人数、日期的基础输入防御。

## Review 分级

- P0 Critical：数据丢失、越权读写、付费/VIP 严重绕过、核心登录不可用、全局黑屏卡死。
- P1 Important：核心链路不闭环、云函数缺鉴权、配额绕过、同步状态错乱、重要功能对部分账号体系不可用。
- P2 Medium：边界输入导致异常、显示或图表错误、低频但真实可触发的体验问题。
- P3 Minor：文案、弱提示、低概率 UI 溢出、非核心冗余。

每条 finding 应包含：文件位置、触发路径、影响、证据、建议修法、建议测试场景。

## 阶段 0：项目地图复核

1. 页面地图
   - `app.json`
   - 主页面 `pages/index/index`
   - AI 分包 `pages/ai-chat/ai-chat`

2. 数据地图
   - 档案：本地 profiles、active profile、云端 `cloud_profiles`
   - 考试：考试列表、隐藏/排除考试、当前选中考试
   - 科目：成绩、满分、班级排名、年级排名、备注
   - VIP：`users.role`、`vipExpireAt`、本地 `xueji_vip_state`
   - AI：本地配额、云函数调用、AI fallback

3. 云函数地图
   - 前端实际调用函数
   - 本地 `cloudfunctions/` 目录
   - `cloudbaserc.json` 配置
   - 线上函数列表与环境变量

4. 缓存地图
   - `xueji_auth_user`
   - `xueji_auth_token`
   - `xueji_auth_refresh_token`
   - `xueji_vip_state`
   - `xueji_vip_quota_*`
   - `xueji_profiles`
   - `xueji_exams`
   - `xueji_active_profile`
   - `xueji_trend_mode`
   - `xueji_radar_selection`

## 阶段 1：静态一致性扫描

1. 云函数一致性
   - 扫 `callFunction('...')`
   - 对比 `cloudfunctions/` 本地目录
   - 对比 `cloudbaserc.json`
   - 对比线上函数和环境变量

2. 敏感信息
   - 前端硬编码密码
   - 默认 token salt
   - SecretId/SecretKey
   - SMTP 密码
   - AI API Key

3. Loading 和超时
   - `wx.showLoading` 是否都有 `hideLoading`
   - `callFunction` 是否有超时兜底
   - AI 是否有本地降级
   - 云同步是否会卡住 UI

4. 输入防御
   - 成绩：NaN、负数、超过满分
   - 满分：0、负数、非数字
   - 排名：0、负数、小数、排名大于总人数
   - 日期：结束日期早于开始日期
   - 文本：超长考试名、档案名、备注

## 阶段 2：账号与 VIP 深审

重点文件：

- `utils/auth.js`
- `utils/vip.js`
- `cloudfunctions/adminLogin/`
- `cloudfunctions/wxLogin/`
- `cloudfunctions/syncOfficialUser/`
- `cloudfunctions/bindAccount/`
- `cloudfunctions/redeemVipCode/`
- `cloudfunctions/verifyToken/`

检查点：

- 微信、邮箱、手机号三套登录是否统一映射到 `users`。
- 登录后 token 刷新是否一致。
- VIP 状态是否在前端、云端、缓存中一致。
- 兑换码并发锁是否可靠。
- VIP 过期后各入口是否一致降级。
- admin 是否只在服务端校验。
- `TOKEN_SALT` 是否所有发 token 的函数都依赖环境变量。

## 阶段 3：云同步深审

重点文件：

- `utils/cloudSync.js`
- `utils/autoSync.js`
- `modules/profileModule.js`
- `cloudfunctions/listCloudProfiles/`
- `cloudfunctions/uploadCloudProfile/`
- `cloudfunctions/getCloudProfileData/`
- `cloudfunctions/deleteCloudProfiles/`
- `cloudfunctions/restoreCloudProfiles/`
- `cloudfunctions/purgeDeletedProfiles/`

检查点：

- 未登录录入后登录，档案是否正确归属。
- 多账号切换是否串档。
- 本地和云端覆盖规则是否清晰。
- 回收站删除/恢复/彻底删除是否都校验 userId。
- 非 VIP 是否能绕过恢复。
- 断网/超时/云函数失败是否不会丢本地数据。
- 归档孤儿档案是否不会误删当前账号档案。

## 阶段 4：成绩计算与图表深审

重点文件：

- `modules/examModule.js`
- `modules/scoreModule.js`
- `modules/batchModule.js`
- `modules/chartModule.js`
- `utils/format.js`
- `utils/chart.js`
- `utils/report.js`

检查点：

- 手动总分和自动总分切换后，列表、详情、趋势图、报告是否一致。
- `excludeHidden=true` 是否所有统计和图表都遵守。
- 空科目、少于 3 科、缺考科目是否不会让雷达图崩。
- 排名趋势图是否正确处理 0/空/null。
- 图表 canvas 在切 tab、弹窗遮挡、页面恢复后是否能重绘。
- 报告生成是否处理超长科目名/考试名。

## 阶段 5：AI 功能深审

重点文件：

- `utils/ai.js`
- `utils/vip.js`
- `pages/ai-chat/ai-chat.js`
- `cloudfunctions/ai_service/`

检查点：

- AI 分析少于 2 场考试是否正确提示。
- 原生 AI 超时后是否 fallback 云函数。
- 云函数失败后是否 fallback 本地基础统计。
- AI 对话失败是否可重试。
- 免费用户每日 2 次、VIP 隐藏上限是否只在前端，还是云端也校验。
- AI 批量识别是否校验输出成绩合法性。
- AI prompt 是否泄露敏感数据或发送过多历史数据。

## 阶段 6：交叉场景复核

优先模拟这些路径：

1. 未登录录入成绩 -> 手机号登录 -> 云同步 -> VIP 兑换 -> AI 分析。
2. 微信登录 -> 绑定手机号 -> 切换手机号登录 -> 云档案仍可见。
3. 邮箱登录 -> 兑换 VIP -> 恢复回收站档案。
4. 手动总分修改 -> 趋势图 -> 雷达图 -> AI 报告 -> 生成分享图。
5. 多档案切换 -> AI 对话页 -> 返回首页 -> 当前档案不串。
6. 删除档案 -> 回收站恢复 -> 当前考试引用不悬空。
7. Token 过期 -> 自动同步 -> 用户提示和退出状态是否一致。

## 阶段 7：验证命令

常规命令：

```powershell
node --check utils\auth.js
node --check utils\vip.js
node --check utils\ai.js
node --check utils\cloudSync.js
node --check utils\validation.js
node --check modules\examModule.js
node --check modules\scoreModule.js
node --check modules\batchModule.js
node --check modules\chartModule.js
Get-ChildItem cloudfunctions -Directory | ForEach-Object { $idx=Join-Path $_.FullName 'index.js'; if (Test-Path $idx) { node --check $idx } }
```

云函数矩阵：

```powershell
$configured = (Get-Content -Raw -Encoding UTF8 cloudbaserc.json | ConvertFrom-Json).functions.name
$local = Get-ChildItem cloudfunctions -Directory | ForEach-Object Name
$calls = Get-ChildItem -Recurse -File -Include *.js pages,modules,utils |
  Select-String -Pattern "callFunction\('([^']+)'" |
  ForEach-Object { if ($_.Line -match "callFunction\('([^']+)'") { $matches[1] } } |
  Sort-Object -Unique
'--- missing local dirs ---'; $calls | Where-Object { $_ -notin $local }
'--- missing cloudbaserc config ---'; $calls | Where-Object { $_ -notin $configured }
'--- local not configured ---'; $local | Where-Object { $_ -notin $configured }
```

敏感信息扫描：

```powershell
Get-ChildItem -Recurse -File -Include *.js,*.json,*.md cloudfunctions,utils,modules,pages |
  Select-String -Pattern 'why123456|cjld-secret|AKID|SecretId|SecretKey|SMTP_PASS\s*[:=]\s*["''][^"'']+|ADMIN_PASSWORD\s*=\s*["''][^"'']+'
```

## 输出格式

每轮 Review 输出：

- 已扫描范围
- Findings，按 P0/P1/P2/P3 排序
- 已修复项
- 未修复但建议修复项
- 需要手工测试路径
- 是否需要部署云函数
- 是否已提交 GitHub

## 当前剩余重点

1. `ai_service` 缺服务端配额校验。
2. `restoreCloudProfiles` 缺服务端 VIP 校验。
3. 云同步交叉场景仍需继续深审。
4. 图表和报告在极端输入下还需真机/开发者工具验证。
