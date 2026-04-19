const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function generateToken(uid) {
  const salt = process.env.TOKEN_SALT;
  if (!salt) throw new Error('TOKEN_SALT 未配置');
  const tokenData = JSON.stringify({ uid, ts: Date.now() });
  return crypto.createHash('sha256').update(tokenData + salt).digest('hex');
}

async function findUserByOpenid(openid) {
  const result = await db.collection('users').where({ weixinOpenid: openid }).limit(1).get();
  return result.data && result.data.length > 0 ? result.data[0] : null;
}

async function updateLoginState(userId, loginMethod) {
  const token = generateToken(typeof userId === 'string' ? userId : userId.toString());
  await db.collection('users').doc(userId).update({
    data: {
      token: token,
      tokenExpireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastLoginMethod: loginMethod,
      lastLoginAt: new Date(),
      loginCount: _.inc(1),
      updatedAt: new Date()
    }
  });
  return token;
}

function buildUserResponse(user) {
  return {
    id: user._id,
    email: user.email || '',
    nickname: user.nickname || '微信用户',
    avatarUrl: user.avatarUrl || null,
    hasWeixin: !!user.weixinOpenid,
    hasPhone: !!user.phone,
    phone: user.phone || '',
    role: user.role || '',
    vipExpireAt: user.vipExpireAt || null
  };
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  if (!OPENID) {
    return { code: -1, message: '获取微信标识失败，请稍后重试' };
  }

  try {
    let user = await findUserByOpenid(OPENID);

    if (!user) {
      const now = new Date();
      const addRes = await db.collection('users').add({
        data: {
          weixinOpenid: OPENID,
          nickname: '微信用户',
          email: '',
          phone: '',
          passwordHash: '',
          avatarUrl: '',
          role: 'user',
          status: 'active',
          loginCount: 0,
          createdAt: now,
          updatedAt: now
        }
      });
      user = {
        _id: addRes._id,
        weixinOpenid: OPENID,
        nickname: '微信用户',
        email: '',
        phone: '',
        role: 'user',
        status: 'active'
      };
      console.log('[wxLogin] 新用户注册');
    } else {
      if (user.status === 'banned') {
        return { code: 403, message: '该账号已被禁用，请联系客服' };
      }
    }

    const token = await updateLoginState(user._id, 'weixin');
    console.log('[wxLogin] 登录成功');

    return {
      code: 0,
      message: '登录成功',
      data: { token: token, user: buildUserResponse(user), expiresIn: 2592000 }
    };
  } catch (err) {
    console.error('[wxLogin] error:', err);
    return { code: 500, message: '微信登录失败：' + (err.message || '未知错误') };
  }
};
