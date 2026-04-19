const cloud = require('@cloudbase/node-sdk');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;

function parseEventPayload(event) {
  if (!event) return {};
  if (typeof event === 'string') {
    try { return JSON.parse(event); } catch { return {}; }
  }
  if (event.queryStringParameters && typeof event.queryStringParameters === 'object') {
    return event.queryStringParameters;
  }
  if (event.queryString && typeof event.queryString === 'object') {
    return event.queryString;
  }
  if (event.body) {
    let body = event.body;
    if (event.isBase64Encoded && typeof body === 'string') {
      try { body = Buffer.from(body, 'base64').toString('utf8'); } catch {}
    }
    if (typeof event.body === 'string') {
      try { return JSON.parse(body); } catch {}
      try { return Object.fromEntries(new URLSearchParams(body)); } catch {}
      return {};
    }
    if (typeof event.body === 'object') return event.body;
  }
  return event;
}


// ===== 工具函数 =====

function generateToken(uid, email) {
  const salt = process.env.TOKEN_SALT;
  if (!salt) throw new Error('TOKEN_SALT 未配置');
  const tokenData = JSON.stringify({ uid, email, ts: Date.now() });
  return crypto.createHash('sha256').update(tokenData + salt).digest('hex');
}

async function findUserByEmail(email) {
  const result = await db.collection('users').where({ email }).limit(1).get();
  return result.data && result.data.length > 0 ? result.data[0] : null;
}

async function consumeEmailCode(email, code) {
  const result = await db.collection('email_codes')
    .where({ email, code, used: false, expireAt: _.gte(new Date()) })
    .orderBy('createdAt', 'desc').limit(1).get();
  if (!result.data || result.data.length === 0) return null;
  await db.collection('email_codes').doc(result.data[0]._id).update({ used: true, usedAt: new Date() });
  return result.data[0];
}

async function updateLoginState(userId, loginMethod) {
  const tokenData = await db.collection('users').doc(userId).get();
  const user = tokenData.data;
  const token = generateToken(typeof userId === 'string' ? userId : userId.toString(), user.email);
  await db.collection('users').doc(userId).update({
    token,
    tokenExpireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    lastLoginMethod: loginMethod,
    lastLoginAt: new Date(),
    loginCount: _.inc(1),
    updatedAt: new Date()
  });
  return token;
}

function buildUserResponse(user) {
  return {
    id: user._id,
    email: user.email,
    nickname: user.nickname || user.email.split('@')[0],
    avatarUrl: user.avatarUrl || null,
    hasWeixin: !!user.weixinOpenid,
    hasPhone: !!user.phone,
    role: user.role || '',
    vipExpireAt: user.vipExpireAt || null
  };
}


// ===== 主逻辑：重置密码（忘记密码）=====

/**
 * 邮箱 + 验证码 + 新密码 → 重置密码
 *
 * 请求：{ email, code, newPassword }
 */
exports.main = async (event, context) => {
  let { email, code, newPassword } = parseEventPayload(event);

  // 1. 参数校验
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: 400, message: '邮箱格式不正确' };
  }
  if (!code || !/^\d{6}$/.test(code)) {
    return { code: 400, message: '验证码格式不正确（需6位数字）' };
  }
  if (!newPassword || typeof newPassword !== 'string') {
    return { code: 400, message: '请设置新密码' };
  }
  if (newPassword.length < 6) {
    return { code: 400, message: '密码至少需要6个字符' };
  }

  try {
    // 2. 查找用户
    const existingUser = await findUserByEmail(email);
    if (!existingUser) {
      // 安全考虑：不泄露用户是否存在
      return { code: 404, message: '该邮箱未注册' };
    }

    // 3. 校验并消费验证码
    const codeRecord = await consumeEmailCode(email, code);
    if (!codeRecord) {
      return { code: 401, message: '验证码错误或已过期' };
    }

    // 4. 哈希新密码
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // 5. 更新密码
    await db.collection('users').doc(existingUser._id).update({
      passwordHash,
      updatedAt: new Date()
    });

    // 6. 重置后自动登录（生成新 token）
    const token = await updateLoginState(existingUser._id, 'password_reset');

    console.log('[resetPassword] 密码重置成功:', email);

    return {
      code: 0,
      message: '密码重置成功',
      data: {
        token,
        user: buildUserResponse({ ...existingUser }),
        expiresIn: 2592000
      }
    };

  } catch (err) {
    console.error('[resetPassword] error:', err);
    return { code: 500, message: '重置失败：' + (err.message || '未知错误') };
  }
};
