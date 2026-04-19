const cloud = require('@cloudbase/node-sdk');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = cloud.init({
  env: cloud.SYMBOL_CURRENT_ENV
});
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

/**
 * 生成 Token
 */
function generateToken(uid, email) {
  const salt = process.env.TOKEN_SALT;
  if (!salt) throw new Error('TOKEN_SALT 未配置');
  const tokenData = JSON.stringify({ uid, email, ts: Date.now() });
  return crypto.createHash('sha256').update(tokenData + salt).digest('hex');
}

/**
 * 更新用户的 token 和登录信息
 */
async function updateLoginState(userId, loginMethod) {
  const tokenData = await db.collection('users').doc(userId).get();
  const user = tokenData.data;
  const token = generateToken(typeof userId === 'string' ? userId : userId.toString(), user.email);

  await db.collection('users').doc(userId).update({
    token,
    tokenExpireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30天
    lastLoginMethod: loginMethod,
    lastLoginAt: new Date(),
    loginCount: _.inc(1),
    updatedAt: new Date()
  });

  return token;
}

/**
 * 校验邮箱验证码是否有效，并标记为已使用
 * @returns {object|null} 返回验证码记录，无效则返回 null
 */
async function consumeEmailCode(email, code) {
  const result = await db.collection('email_codes')
    .where({
      email,
      code,
      used: false,
      expireAt: _.gte(new Date())
    })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  if (!result.data || result.data.length === 0) {
    return null;
  }

  // 标记为已使用
  await db.collection('email_codes')
    .doc(result.data[0]._id)
    .update({ used: true, usedAt: new Date() });

  return result.data[0];
}

/**
 * 检查邮箱是否已被注册
 */
async function findUserByEmail(email) {
  const result = await db.collection('users')
    .where({ email })
    .limit(1)
    .get();
  return result.data && result.data.length > 0 ? result.data[0] : null;
}

/**
 * 构建用户响应对象
 */
function buildUserResponse(user, token) {
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


// ===== 主逻辑：邮箱注册 =====

/**
 * 邮箱 + 验证码 + 密码 注册
 *
 * 请求：{ email, code, password }
 */
exports.main = async (event, context) => {
  let { email, code, password } = parseEventPayload(event);

  // 1. 参数校验
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: 400, message: '邮箱格式不正确' };
  }
  if (!code || !/^\d{6}$/.test(code)) {
    return { code: 400, message: '验证码格式不正确（需6位数字）' };
  }
  if (!password || typeof password !== 'string') {
    return { code: 400, message: '请设置密码' };
  }
  if (password.length < 6) {
    return { code: 400, message: '密码至少需要6个字符' };
  }

  try {
    // 2. 检查邮箱是否已注册
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return { code: 409, message: '该邮箱已注册，请直接登录' };
    }

    // 3. 校验验证码并消费
    const codeRecord = await consumeEmailCode(email, code);
    if (!codeRecord) {
      return { code: 401, message: '验证码错误或已过期' };
    }

    // 4. 哈希密码
    const passwordHash = await bcrypt.hash(password, 10);

    // 5. 创建用户
    const nickname = email.split('@')[0];
    const createResult = await db.collection('users').add({
      email,
      emailVerified: true,
      passwordHash,
      nickname,
      avatarUrl: null,

      // 微信预留字段
      weixinOpenid: null,
      weixinUnionid: null,

      // 手机预留字段
      phone: null,
      phoneVerified: false,

      // 时间戳
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: new Date(),
      loginCount: 1,
      status: 'active',
      profileCount: 0
    });

    const userId = createResult.id;

    // 6. 生成 token
    const token = await updateLoginState(userId, 'email_register');

    console.log('[emailRegister] 新用户注册:', email);

    return {
      code: 0,
      message: '注册成功',
      data: {
        token,
        user: buildUserResponse({ _id: userId, email, nickname }, token),
        expiresIn: 2592000
      }
    };

  } catch (err) {
    console.error('[emailRegister] error:', err);
    return { code: 500, message: '注册失败：' + (err.message || '未知错误') };
  }
};
