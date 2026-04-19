const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function buildUserResponse(user) {
  return {
    id: user._id,
    email: user.email || '',
    phone: user.phone || '',
    nickname: user.nickname || user.email || user.phone || '云端用户',
    avatarUrl: user.avatarUrl || '',
    isAdmin: !!user.isAdmin,
    role: user.role || '',
    vipExpireAt: user.vipExpireAt || null
  };
}

exports.main = async (event) => {
  const token = event.token || '';
  if (!token) return { code: 401, message: '缺少登录凭证' };

  try {
    const result = await db.collection('users').where({
      token,
      tokenExpireAt: _.gt(new Date())
    }).limit(1).get();

    if (!result.data || result.data.length === 0) {
      return { code: 401, message: '登录已过期' };
    }

    return { code: 0, data: buildUserResponse(result.data[0]) };
  } catch (err) {
    console.error('[verifyToken] error:', err);
    return { code: 500, message: '验证登录状态失败' };
  }
};
