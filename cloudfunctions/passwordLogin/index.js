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

async function consumeEmailCode(email, code) {
  const result = await db.collection('email_codes')
    .where({ email, code, used: false, expireAt: _.gte(new Date()) })
    .orderBy('createdAt', 'desc').limit(1).get();
  if (!result.data || result.data.length === 0) return null;
  await db.collection('email_codes').doc(result.data[0]._id).update({ used: true, usedAt: new Date() });
  return result.data[0];
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


// ===== 主逻辑 A：邮箱+密码登录 =====

/**
 * 邮箱 + 密码登录（不需要验证码）
 *
 * 请求：{ email, password }
 */
exports.main = async (event, context) => {
  const { email, password } = parseEventPayload(event);

  // 1. 参数校验
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: 400, message: '邮箱格式不正确' };
  }
  if (!password || typeof password !== 'string') {
    return { code: 400, message: '请输入密码' };
  }

  try {
    // 2. 查找用户
    const existingUser = await findUserByEmail(email);
    if (!existingUser) {
      // 安全考虑：不明确提示"用户不存在"，统一提示
      return { code: 401, message: '邮箱或密码错误' };
    }

    // 3. 检查是否设过密码（验证码注册但未设密码的情况）
    if (!existingUser.passwordHash) {
      return { code: 402, message: '该账号尚未设置密码，请使用验证码登录' };
    }

    // 4. 检查账号状态
    if (existingUser.status !== 'active') {
      return { code: 403, message: '该账号已被禁用，请联系客服' };
    }

    // 5. 校验密码
    const isMatch = await bcrypt.compare(password, existingUser.passwordHash);
    if (!isMatch) {
      return { code: 401, message: '邮箱或密码错误' };
    }

    // 6. 更新登录态
    const token = await updateLoginState(existingUser._id, 'email_password');

    console.log('[passwordLogin] 密码登录:', email);

    return {
      code: 0,
      message: '登录成功',
      data: {
        token,
        user: buildUserResponse({ ...existingUser }),
        expiresIn: 2592000
      }
    };

  } catch (err) {
    console.error('[passwordLogin] error:', err);
    return { code: 500, message: '登录失败：' + (err.message || '未知错误') };
  }
};
