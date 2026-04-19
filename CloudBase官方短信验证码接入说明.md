# CloudBase 官方短信验证码接入说明

## 背景

成绩雷达小程序使用 CloudBase 身份认证提供的官方短信验证码能力。

该能力不是开发者自行配置腾讯云短信 SecretId / SecretKey 后发短信，也不是云函数调用 `cloud.openapi.cloudbase.sendSms`。它属于 CloudBase 身份认证的开箱即用验证码渠道，由 CloudBase 根据登录方式配置直接发送短信。

控制台路径：

- CloudBase 控制台
- 身份认证
- 登录方式
- 短信验证码
- 短信来源选择“云开发短信资源包”
- `SmsVerificationConfig.Type` 为 `default`

当前环境：

```text
chengjiguanjia-1g1twvrkd736c880
```

已确认云端登录策略：

```json
{
  "PhoneNumberLogin": true,
  "PhoneLogin": true,
  "SmsVerificationConfig": {
    "Type": "default",
    "SmsDayLimit": 10
  }
}
```

## 原理

官方短信验证码流程分三步：

1. 发送验证码

   客户端请求 CloudBase Auth HTTP API：

   ```text
   POST /auth/v1/verification
   ```

   手机号格式必须带国家码：

   ```json
   {
     "phone_number": "+86 13800138000",
     "target": "ANY"
   }
   ```

   返回：

   ```json
   {
     "verification_id": "...",
     "expires_in": 600,
     "is_user": true
   }
   ```

2. 校验验证码

   客户端把用户输入的 6 位验证码和 `verification_id` 发给：

   ```text
   POST /auth/v1/verification/verify
   ```

   返回：

   ```json
   {
     "verification_token": "...",
     "expires_in": 600
   }
   ```

3. 使用 `verification_token`

   - 登录：`POST /auth/v1/signin`
   - 注册：`POST /auth/v1/signup`
   - 修改手机号：`POST /auth/v1/user/basic/edit`
   - 重置密码：先登录/校验，再获取 `sudo_token`，再改密码

## 当前实现

主要代码在：

```text
utils/auth.js
```

核心常量：

```js
const AUTH_API_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`;
```

核心辅助函数：

- `authApiRequest(path, options)`：统一请求 CloudBase Auth HTTP API
- `sendOfficialPhoneCode(phone, scene)`：发送官方短信验证码
- `verifyOfficialCode(account, code, scene)`：校验验证码并取得 `verification_token`
- `officialSignInWithVerification(verificationToken)`：手机号验证码登录
- `officialSignUpWithPhone(phone, verificationToken, password)`：手机号注册
- `saveOfficialSession(tokenData)`：保存官方 Auth 返回的 token 和用户资料

手机号链路：

- 发送验证码：`sendSmsCode(phone, scene)`
- 验证码登录：`codeLogin(account, code)`
- 手机号注册：`register(account, code, password)`
- 手机号重置密码：`resetPassword(account, code, newPassword)`
- 绑定手机号：`bindAccount('phone', value, code)`

邮箱、微信登录链路暂时保持原实现，避免一次性重构过大。

## 为什么不再使用 sendSmsCode 云函数

旧实现：

```text
前端 -> callFunction('sendSmsCode') -> cloud.openapi.cloudbase.sendSms -> sms_codes
```

这条链路需要云函数具备 OpenAPI 权限：

```json
{
  "permissions": {
    "openapi": ["cloudbase.sendSms"]
  }
}
```

实际线上日志出现：

```text
errCode: -604101
function has no permission to call this API
```

该错误说明云函数没有权限调用 `cloudbase.sendSms`。但项目目标是使用 CloudBase 身份认证的官方默认短信验证码，因此不应该走这个自建云函数发短信路径。

新实现绕开 `sendSmsCode` 云函数，直接调用 CloudBase Auth 官方验证码接口。

## 注意事项

1. 小程序真机和发布版可能需要配置 request 合法域名：

   ```text
   https://chengjiguanjia-1g1twvrkd736c880.api.tcloudbasegateway.com
   ```

2. 官方验证码发送频率由 CloudBase 管理。

   常见限制：

   - 同一手机号 60 秒内只能发送一次
   - 每用户每天接收上限由控制台配置决定
   - 当前配置为每天 10 条

3. 手机号格式必须转为：

   ```text
   +86 13800138000
   ```

   不能直接传：

   ```text
   13800138000
   ```

4. 如果接口返回 `captcha_required`，说明 CloudBase 要求人机验证。

   当前代码提示用户稍后重试或换用其他登录方式，暂未接入图片验证码 UI。

5. `verification_id` 需要本地临时保存。

   当前实现用本地 storage 保存：

   ```text
   xueji_auth_verification_{scene}_{account}
   ```

   用于用户输入验证码后继续校验。

## 验证结果

修改后已实际验证：

```text
短信发送成功
```

这说明当前官方 Auth 短信通道、控制台配置、接口路径、手机号格式均已打通。

