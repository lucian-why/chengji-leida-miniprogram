# 成绩雷达小程序 Code Review 最终报告

生成时间：2026-04-21

## 结论

本轮 Code Review 已完成账号、云同步、成绩计算、AI 成本控制四条高风险链路的扫描和关键修复。当前最值得上线前手测的不是单点页面，而是跨设备、跨登录方式、跨云同步状态的组合场景。

已修复的高风险问题集中在：

- 云函数配置不完整，可能导致新环境部署漏函数。
- 前端硬编码管理员密码。
- `TOKEN_SALT` 默认值导致 token 安全边界变弱。
- 手机号官方 Auth 与旧 `users` 体系割裂。
- 手机号/邮箱用户无法兑换 VIP。
- 多设备同步用临时 `exportedAt` 比较，导致 B 设备可能漏下载 A 设备更新。
- 孤儿档案先删本地再传云端，网络失败时可能丢数据。
- B 设备登录后 `_refreshCurrentExam is not a function`。
- A 设备删除档案后，B 设备未同步删除。
- 回收站删除确认弹窗层级被遮挡。
- AI 对话手动总分 0 被自动总分覆盖。
- 缺失满分时 UI/报告显示 `--%`。
- `ai_service` 缺服务端登录和配额校验。
- `ai_service` 部署缺 `prompts` 模块。

## 已部署/已提交

| 模块 | 状态 | 关键提交 |
|---|---|---|
| 云函数矩阵、admin、TOKEN_SALT、手机号映射 | 已修复并部署 | `b72dde9` |
| VIP 兑换兼容手机号/邮箱 | 已修复并部署 | `2a93567` |
| 云同步生命周期与跨设备删除 | 已修复并推送 | `54ca2ff` |
| 成绩/报告边界显示 | 已修复并推送 | `46add6b` |
| Phase 5 AI Review 记录 | 已提交并推送 | `e1de7f8` |
| AI 云函数服务端配额轻量修复 | 已修复、部署并推送 | `3d006b7` |

## 当前仍暂缓的风险

### 1. 回收站恢复仍缺服务端 VIP 校验

- 文件：`cloudfunctions/restoreCloudProfiles/index.js`
- 风险：非 VIP 可绕过前端直接调用云函数恢复回收站档案。
- 当前决策：暂缓。用户之前明确第三项不需要管。
- 建议：上线前如果回收站恢复是付费点，建议补服务端 `users.role/vipExpireAt` 校验。

### 2. AI 输入长度限制暂未做

- 文件：`cloudfunctions/ai_service/index.js`
- 风险：直接调用云函数可提交超长 prompt，造成延迟和成本上升。
- 当前决策：暂未改。
- 建议上限：
  - `inputParse.text`：2000 字
  - AI 对话单次输入：800-1200 字
  - AI 对话历史：最近 20 条
  - AI 对话总字符：8000 字
  - AI 分析 payload：30KB

### 3. AI raw event 日志暂不改

- 文件：`cloudfunctions/ai_service/index.js`
- 风险：成绩、粘贴文本、聊天内容可能进入云函数日志。
- 当前决策：用户要求第三个不改。

### 4. 原生 AI 路径仍由前端本地配额控制

- 说明：本轮采用 P1 轻量修复，只保护 `ai_service` 云函数 fallback。
- 影响：正常体验影响最小；但若未来要完全服务端控成本，需要把原生 AI 也收口到云函数。

## 最小手测清单

优先按下面顺序测。每条都是真实用户高风险路径。

### A. 登录与账号

1. 微信登录成功，昵称显示正常。
2. 邮箱验证码登录成功，确认邮箱功能仍走原有链路。
3. 手机号验证码登录成功，确认 CloudBase 官方短信仍可发送。
4. 手机号登录后退出，再重新登录，用户档案/VIP 状态不丢。
5. admin 登录成功，前端不再需要硬编码密码。

### B. VIP

1. 微信用户兑换 VIP 成功。
2. 手机号用户兑换 VIP 成功。
3. 邮箱用户兑换 VIP 成功。
4. 兑换成功后重新进入小程序，VIP 状态仍存在。
5. 非 VIP 打开 VIP 功能入口时提示正常。

### C. 云同步与跨设备

1. A 设备新增档案和考试，B 设备登录后能同步看到。
2. A 设备修改某场考试成绩，B 设备重新进入后能同步更新。
3. A 设备删除档案，B 设备同步后该档案从列表消失，并进入回收站。
4. A 设备把档案移入回收站，网络正常时云端回收站可见。
5. 断网或云函数失败时，孤儿档案不应本地先消失。
6. B 设备登录后不再出现 `_refreshCurrentExam is not a function`。

### D. 回收站

1. 打开回收站弹窗，点击彻底删除。
2. 删除确认弹窗应显示在最上层，不被回收站弹窗遮挡。
3. 取消删除后数据仍在回收站。
4. 确认删除后数据从回收站消失。

### E. 成绩、图表、报告

1. 新建考试，录入正常成绩、满分、班排、年排。
2. 尝试录入负数、NaN、排名 0、排名超过总人数，确认有拦截。
3. 手动总分设为 0，页面、报告、AI 对话里的总分都应一致显示 0。
4. 满分缺失或旧数据场景，页面和报告应显示 `--`，不是 `--%`。
5. 隐藏/排除某场考试后，趋势图、雷达图、报告统计一致。

### F. AI

1. 少于 2 场考试时 AI 分析显示“再多记录几场考试”。
2. 登录用户点击 AI 分析，正常返回或降级到本地基础统计，不黑屏不卡 loading。
3. AI 对话发送问题，失败后按钮状态恢复，可重试。
4. 免费用户超过每日次数后，前端提示正常。
5. 直接空调用 `ai_service` 应返回 `401 请先登录后再使用 AI 功能`。
6. 登录用户通过云函数 fallback 调用 AI，应不再返回 401。

## 已执行自动检查

### 语法检查

已执行并通过：

```powershell
node --check utils\auth.js
node --check utils\vip.js
node --check utils\ai.js
node --check utils\cloudSync.js
node --check utils\autoSync.js
node --check utils\validation.js
node --check utils\storage.js
node --check utils\report.js
node --check modules\examModule.js
node --check modules\scoreModule.js
node --check modules\batchModule.js
node --check modules\chartModule.js
node --check pages\index\index.js
node --check pages\ai-chat\ai-chat.js
Get-ChildItem cloudfunctions -Directory | ForEach-Object {
  $idx = Join-Path $_.FullName 'index.js'
  if (Test-Path $idx) { node --check $idx }
}
```

### 云函数矩阵检查

已执行并通过：

- 前端 `callFunction(...)` 调用的函数全部有本地目录。
- 前端调用的函数全部写入 `cloudbaserc.json`。
- 本地 `cloudfunctions/` 目录没有遗漏配置项。

### 线上云函数检查

已执行并通过：

```powershell
tcb fn invoke ai_service
```

结果：返回 `401 请先登录后再使用 AI 功能`，说明 `ai_service` 已部署且入口鉴权生效。

## 建议上线前最后动作

1. 用微信开发者工具重新上传体验版。
2. 用 A/B 两台真机按“最小手测清单”跑一遍。
3. 特别确认手机号短信、邮箱验证码、VIP 兑换、AI 分析、云同步删除这 5 条链路。
4. 如果 AI 成本压力明显，再补 P2 输入长度限制。
5. 如果回收站恢复是付费核心能力，再补服务端 VIP 校验。
