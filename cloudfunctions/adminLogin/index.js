const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function getTokenSalt() {
  const salt = process.env.TOKEN_SALT;
  if (!salt) throw new Error('TOKEN_SALT 未配置');
  return salt;
}

function generateToken(uid) {
  const tokenData = JSON.stringify({ uid, ts: Date.now() });
  return crypto.createHash('sha256').update(tokenData + getTokenSalt()).digest('hex');
}

function buildUserResponse(user) {
  return {
    id: user._id,
    email: user.email || '',
    phone: user.phone || '',
    nickname: user.nickname || '管理员',
    avatarUrl: user.avatarUrl || '',
    isAdmin: true,
    role: 'admin',
    vipExpireAt: user.vipExpireAt || null
  };
}

async function findOrCreateAdmin() {
  const existing = await db.collection('users').where({ role: 'admin' }).limit(1).get();
  if (existing.data && existing.data[0]) return existing.data[0];

  const now = new Date();
  const created = await db.collection('users').add({
    data: {
      nickname: '管理员',
      email: '',
      phone: '',
      role: 'admin',
      isAdmin: true,
      status: 'active',
      createdAt: now,
      updatedAt: now
    }
  });
  return {
    _id: created._id,
    nickname: '管理员',
    role: 'admin',
    isAdmin: true,
    status: 'active'
  };
}

exports.main = async (event) => {
  const password = String(event.password || '');
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) return { code: 500, message: 'ADMIN_PASSWORD 未配置' };
  if (!password || password !== expected) return { code: 401, message: '账号或密码错误' };

  try {
    const user = await findOrCreateAdmin();
    if (user.status === 'banned') return { code: 403, message: '该账号已被禁用' };

    const token = generateToken(String(user._id));
    await db.collection('users').doc(user._id).update({
      data: {
        token,
        tokenExpireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastLoginMethod: 'admin',
        lastLoginAt: new Date(),
        loginCount: _.inc(1),
        updatedAt: new Date()
      }
    });

    return {
      code: 0,
      data: {
        token,
        user: buildUserResponse(user),
        expiresIn: 2592000
      }
    };
  } catch (err) {
    console.error('[adminLogin] error:', err);
    return { code: 500, message: err.message || '管理员登录失败' };
  }
};
