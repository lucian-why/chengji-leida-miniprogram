const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const AUTH_API_BASE = 'chengjiguanjia-1g1twvrkd736c880.api.tcloudbasegateway.com';

// ============ Token 验证 ============

function generateToken(uid) {
  const salt = process.env.TOKEN_SALT;
  if (!salt) throw new Error('TOKEN_SALT 未配置');
  const tokenData = JSON.stringify({ uid, ts: Date.now() });
  return crypto.createHash('sha256').update(tokenData + salt).digest('hex');
}

async function verifyToken(token) {
  if (!token) return null;
  const result = await db.collection('users').where({
    token,
    tokenExpireAt: _.gt(new Date())
  }).limit(1).get();
  return result.data && result.data.length > 0 ? result.data[0] : null;
}

// ============ 查询辅助 ============

async function findUserById(userId) {
  try {
    const result = await db.collection('users').doc(userId).get();
    return result.data || null;
  } catch (e) {
    return null;
  }
}

async function findUserByPhone(phone) {
  const result = await db.collection('users').where({ phone }).limit(1).get();
  return result.data && result.data.length > 0 ? result.data[0] : null;
}

async function findUserByEmail(email) {
  const result = await db.collection('users').where({ email }).limit(1).get();
  return result.data && result.data.length > 0 ? result.data[0] : null;
}

// ============ 验证码校验 ============

/**
 * 校验验证码：
 * - 手机号：通过 CloudBase Auth SDK 的方式（与前端 sendSmsCode 对应）
 * - 邮箱：查询验证码记录集合
 */
function postAuthApi(path, data, deviceId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data || {});
    const req = https.request({
      hostname: AUTH_API_BASE,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-device-id': deviceId || 'cloud-function'
      },
      timeout: 10000
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (e) {
          reject(new Error('官方验证码服务返回异常'));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && !parsed.error) {
          resolve(parsed);
          return;
        }
        reject(new Error(parsed.error_description || parsed.message || parsed.error || '官方验证码校验失败'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('官方验证码校验超时')));
    req.write(body);
    req.end();
  });
}

async function verifyOfficialPhoneCode(code, verificationId, deviceId) {
  if (!verificationId) return false;
  try {
    const result = await postAuthApi('/auth/v1/verification/verify', {
      verification_id: verificationId,
      verification_code: code
    }, deviceId);
    return !!result.verification_token;
  } catch (e) {
    console.warn('[bindAccount] official phone code verify error:', e.message);
    return false;
  }
}

async function verifyCode(type, value, code, options = {}) {
  if (type === 'phone') {
    if (options.verificationId) {
      return await verifyOfficialPhoneCode(code, options.verificationId, options.deviceId);
    }
    return await verifyCodeFromCollection('sms_codes', value, code);
  }

  if (type === 'email') {
    return await verifyCodeFromCollection('email_codes', value, code);
  }

  return false;
}

async function verifyCodeFromCollection(collection, value, code) {
  try {
    // sms_codes 用 phone 字段，email_codes 用 email 字段
    const queryField = collection === 'sms_codes' ? 'phone' : 'email';
    const result = await db.collection(collection).where({
      [queryField]: value,
      code: code,
      used: false,
      expireAt: _.gt(new Date())
    }).orderBy('createdAt', 'desc').limit(1).get();

    if (!result.data || result.data.length === 0) {
      return false;
    }

    // 标记为已使用
    await db.collection(collection).doc(result.data[0]._id).update({
      data: {
        used: true,
        usedAt: new Date()
      }
    });

    return true;
  } catch (e) {
    console.warn('[bindAccount] verifyCode error:', e.message);
    return false;
  }
}

// ============ 合并逻辑 ============

/**
 * 静默合并：将旧账号的数据迁移到当前账号
 * - cloud_profiles: userId 字段迁移
 * - 旧账号标记为 merged
 */
async function mergeAccounts(currentUser, existingUser) {
  const currentUserId = currentUser._id;
  const existingUserId = existingUser._id;

  console.log(`[bindAccount] 静默合并: 旧账号 ${existingUserId} -> 当前账号 ${currentUserId}`);

  // 1. 迁移 cloud_profiles 数据
  try {
    const profilesResult = await db.collection('cloud_profiles').where({
      userId: existingUserId
    }).get();

    if (profilesResult.data && profilesResult.data.length > 0) {
      for (const profile of profilesResult.data) {
        await db.collection('cloud_profiles').doc(profile._id).update({
          data: { userId: currentUserId }
        });
      }
      console.log(`[bindAccount] 迁移了 ${profilesResult.data.length} 个档案`);
    }
  } catch (e) {
    console.warn('[bindAccount] 迁移 cloud_profiles 失败:', e.message);
  }

  // 2. 如果当前用户没有 openid 但旧用户有，继承 openid
  if (!currentUser.weixinOpenid && existingUser.weixinOpenid) {
    await db.collection('users').doc(currentUserId).update({
      data: { weixinOpenid: existingUser.weixinOpenid }
    });
  }

  // 3. 如果当前用户没有 email 但旧用户有，继承 email
  if (!currentUser.email && existingUser.email) {
    await db.collection('users').doc(currentUserId).update({
      data: { email: existingUser.email }
    });
  }

  // 4. 如果当前用户没有 phone 但旧用户有，继承 phone
  if (!currentUser.phone && existingUser.phone) {
    await db.collection('users').doc(currentUserId).update({
      data: { phone: existingUser.phone }
    });
  }

  // 5. 如果当前用户没有昵称（或叫"微信用户"），继承旧用户的昵称
  if ((!currentUser.nickname || currentUser.nickname === '微信用户') && existingUser.nickname && existingUser.nickname !== '微信用户') {
    await db.collection('users').doc(currentUserId).update({
      data: { nickname: existingUser.nickname }
    });
  }

  // 6. 继承 VIP 状态（取更优的）
  if (existingUser.vipExpireAt && existingUser.role === 'vip') {
    const currentVip = currentUser.vipExpireAt ? new Date(currentUser.vipExpireAt).getTime() : 0;
    const existingVip = new Date(existingUser.vipExpireAt).getTime();
    if (existingVip > currentVip) {
      await db.collection('users').doc(currentUserId).update({
        data: { vipExpireAt: existingUser.vipExpireAt, role: 'vip' }
      });
    }
  }

  // 7. 标记旧账号为 merged（软删除）
  await db.collection('users').doc(existingUserId).update({
    data: {
      status: 'merged',
      mergedTo: currentUserId,
      updatedAt: new Date()
    }
  });

  console.log('[bindAccount] 合并完成');
}

// ============ 响应构建 ============

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

// ============ 主函数 ============

exports.main = async (event, context) => {
  const { type, value, code, token, verificationId, deviceId } = event;

  // 参数校验
  if (!type || !value || !code) {
    return { code: -1, message: '参数不完整' };
  }

  if (type !== 'phone' && type !== 'email') {
    return { code: -1, message: 'type 只能是 phone 或 email' };
  }

  if (type === 'phone' && !/^1[3-9]\d{9}$/.test(value)) {
    return { code: -1, message: '手机号格式不正确' };
  }

  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { code: -1, message: '邮箱格式不正确' };
  }

  if (!/^\d{6}$/.test(code)) {
    return { code: -1, message: '验证码格式不正确' };
  }

  // Token 验证
  const currentUser = await verifyToken(token);
  if (!currentUser) {
    return { code: 401, message: '登录已过期，请重新登录' };
  }

  // 检查是否已绑定
  if (type === 'phone' && currentUser.phone) {
    return { code: -2, message: '该账号已绑定手机号' };
  }
  if (type === 'email' && currentUser.email) {
    return { code: -2, message: '该账号已绑定邮箱' };
  }

  // 验证码校验
  const codeValid = await verifyCode(type, value, code, { verificationId, deviceId });
  if (!codeValid) {
    return { code: -3, message: '验证码错误或已过期' };
  }

  try {
    // 查找是否已有同手机号/邮箱的账号
    let existingUser = null;
    if (type === 'phone') {
      existingUser = await findUserByPhone(value);
    } else {
      existingUser = await findUserByEmail(value);
    }

    if (existingUser) {
      // 已有账号：检查是否就是当前用户自己
      if (existingUser._id === currentUser._id) {
        return { code: -2, message: '该账号已绑定' };
      }

      // 检查旧账号是否已被合并
      if (existingUser.status === 'merged') {
        // 已合并的账号，直接更新当前用户字段即可
        await db.collection('users').doc(currentUser._id).update({
          data: {
            [type === 'phone' ? 'phone' : 'email']: value,
            updatedAt: new Date()
          }
        });
      } else {
        // 静默合并
        await mergeAccounts(currentUser, existingUser);
      }
    }

    // 给当前用户写入绑定字段
    const updateData = {
      [type === 'phone' ? 'phone' : 'email']: value,
      updatedAt: new Date()
    };
    await db.collection('users').doc(currentUser._id).update({ data: updateData });

    // 重新获取最新用户信息
    const updatedUser = await findUserById(currentUser._id);
    const newToken = generateToken(updatedUser._id.toString());
    await db.collection('users').doc(updatedUser._id).update({
      data: {
        token: newToken,
        tokenExpireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date()
      }
    });

    console.log(`[bindAccount] 绑定${type === 'phone' ? '手机号' : '邮箱'}成功`);

    return {
      code: 0,
      message: `绑定${type === 'phone' ? '手机号' : '邮箱'}成功`,
      data: {
        token: newToken,
        user: buildUserResponse(updatedUser),
        merged: !!existingUser && existingUser.status !== 'merged'
      }
    };
  } catch (err) {
    console.error('[bindAccount] error:', err);
    return { code: 500, message: '绑定失败：' + (err.message || '未知错误') };
  }
};
