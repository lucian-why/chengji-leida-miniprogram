const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const code = (event.code || '').trim().toUpperCase();
  const token = event.token || '';
  const userId = event.userId || '';

  if (!OPENID && (!token || !userId)) {
    return { code: -1, message: '请先登录' };
  }
  if (!code) {
    return { code: -1, message: '请输入兑换码' };
  }

  try {
    // 1. 获取用户信息
    let user = null;
    if (token && userId) {
      const userRes = await db.collection('users').where({
        _id: userId,
        token,
        tokenExpireAt: _.gt(new Date())
      }).limit(1).get();
      user = userRes.data && userRes.data[0];
    }

    if (!user && OPENID) {
      const userRes = await db.collection('users').where({ weixinOpenid: OPENID }).limit(1).get();
      user = userRes.data && userRes.data[0];
    }

    if (!user) {
      return { code: -1, message: '找不到当前账号，请重新登录' };
    }

    // 2. 原生并发锁机制：原子更新 code 状态。确保同一个码不会被多人同时兑换。
    const lockRes = await db.collection('vip_codes').where({
      code: code,
      status: 'unused'
    }).update({
      data: {
        status: 'used',
        usedBy: user._id,
        usedByOpenid: OPENID || user.weixinOpenid || '',
        usedTime: db.serverDate()
      }
    });

    if (lockRes.stats.updated === 0) {
      // 没有更新成功，说明码不存在、已被用，或者刚刚被别人并发抢走了
      return { code: 400, message: '兑换码无效或已被使用' };
    }

    // 3. 兑换码已被当前请求安全锁定，读取该兑换码的面值
    const codeRes = await db.collection('vip_codes').where({ code: code }).limit(1).get();
    const codeData = codeRes.data[0];

    const durationDays = codeData.durationDays || 31;
    const vipType = codeData.type || 'month'; // 'month', 'quarter', 'year'
    
    // 4. 计算新的过期时间和 VIP 类型
    const now = new Date();
    let expireAt = user.vipExpireAt;
    let currentExpire = expireAt ? new Date(expireAt) : null;

    // 如果没有过期时间，或者已经过期了，那么从“现在”开始算
    if (!currentExpire || currentExpire.getTime() < now.getTime()) {
      currentExpire = now;
    }

    const newExpireAt = new Date(currentExpire.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // 确定新的 role 权重，低级别的卡不能覆盖高级别的卡标志（但时间会累加）
    // admin 永久 VIP，不允许被兑换码降级
    const rank = { 'month': 1, 'quarter': 2, 'year': 3, 'vip': 1 };
    let newRole;
    if (user.role === 'admin') {
      newRole = 'admin';
    } else {
      const currentRank = rank[user.role] || 0;
      const newRank = rank[vipType] || 0;
      newRole = newRank > currentRank ? vipType : (user.role || 'month');
    }

    // 5. 更新用户的 VIP 信息
    await db.collection('users').doc(user._id).update({
      data: {
        vipExpireAt: newExpireAt,
        role: newRole,
        updatedAt: db.serverDate()
      }
    });

    console.log(`[redeemVipCode] 用户 ${user._id} 成功核销兑换码 ${code}，新增 ${durationDays} 天`);

    return {
      code: 0,
      message: '兑换成功',
      data: {
        vipExpireAt: newExpireAt,
        role: newRole
      }
    };

  } catch (err) {
    console.error('[redeemVipCode] error:', err);
    return { code: 500, message: '服务器异常，请稍后重试' };
  }
};
