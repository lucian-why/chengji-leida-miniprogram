const cloud = require('@cloudbase/node-sdk');
const crypto = require('crypto');

const app = cloud.init({
  env: cloud.SYMBOL_CURRENT_ENV
});
const db = app.database();
const _ = db.command;

exports.main = async (event) => {
  const { email, code } = parseEventPayload(event);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return { code: 400, message: '邮箱格式不正确' };
  }
  if (!code || !/^\d{6}$/.test(String(code))) {
    return { code: 400, message: '验证码格式不正确（需6位数字）' };
  }

  try {
    const existingUser = await findUserByEmail(email);
    if (!existingUser) {
      return { code: 404, registered: false, message: '该邮箱尚未注册，请先注册' };
    }

    if (existingUser.status !== 'active') {
      return { code: 403, message: '该账号已被禁用，请联系客服' };
    }

    const codeRecord = await consumeEmailCode(email, code);
    if (!codeRecord) {
      return { code: 401, message: '验证码错误或已过期' };
    }

    const token = await updateLoginState(existingUser._id, 'email_code');

    return {
      code: 0,
      message: '登录成功',
      data: {
        token,
        user: buildUserResponse(existingUser),
        expiresIn: 2592000
      }
    };
  } catch (err) {
    console.error('[emailLogin] error:', err);
    return { code: 500, message: '登录失败：' + (err.message || '未知错误') };
  }
};

async function consumeEmailCode(email, code) {
  const result = await db.collection('email_codes')
    .where({ email, code, used: false, expireAt: _.gte(new Date()) })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  if (!result.data || result.data.length === 0) return null;

  await db.collection('email_codes').doc(result.data[0]._id).update({
    used: true,
    usedAt: new Date()
  });
  return result.data[0];
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

function generateToken(uid, email) {
  const salt = process.env.TOKEN_SALT;
  if (!salt) throw new Error('TOKEN_SALT 未配置');
  const tokenData = JSON.stringify({ uid, email, ts: Date.now() });
  return crypto
    .createHash('sha256')
    .update(tokenData + salt)
    .digest('hex');
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
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch {}
      try { return Object.fromEntries(new URLSearchParams(body)); } catch {}
      return {};
    }
    if (typeof body === 'object') return body;
  }
  return event;
}
