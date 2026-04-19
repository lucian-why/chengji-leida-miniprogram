const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const ENV_ID = 'chengjiguanjia-1g1twvrkd736c880';

function getTokenSalt() {
  const salt = process.env.TOKEN_SALT;
  if (!salt) throw new Error('TOKEN_SALT 未配置');
  return salt;
}

function generateToken(uid) {
  const tokenData = JSON.stringify({ uid, ts: Date.now() });
  return crypto.createHash('sha256').update(tokenData + getTokenSalt()).digest('hex');
}

function requestAuth(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'GET',
      hostname: `${ENV_ID}.api.tcloudbasegateway.com`,
      path,
      headers: {
        Authorization: `Bearer ${token}`,
        'x-device-id': 'cloud-function'
      },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = body ? JSON.parse(body) : {}; } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300 && data && !data.error) {
          resolve(data);
          return;
        }
        reject(new Error((data && (data.error_description || data.message || data.error)) || '官方账号校验失败'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('官方账号校验超时')));
    req.end();
  });
}

function normalizePhone(value) {
  return String(value || '').replace(/^\+86\s*/, '').trim();
}

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

async function findUser(profile) {
  if (profile.sub) {
    const bySub = await db.collection('users').where({ officialAuthSub: profile.sub }).limit(1).get();
    if (bySub.data && bySub.data[0]) return bySub.data[0];
  }

  const phone = normalizePhone(profile.phone_number || profile.phone);
  if (phone) {
    const byPhone = await db.collection('users').where({ phone }).limit(1).get();
    if (byPhone.data && byPhone.data[0]) return byPhone.data[0];
  }

  if (profile.email) {
    const byEmail = await db.collection('users').where({ email: profile.email }).limit(1).get();
    if (byEmail.data && byEmail.data[0]) return byEmail.data[0];
  }

  return null;
}

async function upsertUser(profile) {
  const phone = normalizePhone(profile.phone_number || profile.phone);
  const now = new Date();
  let user = await findUser(profile);

  if (!user) {
    const addRes = await db.collection('users').add({
      data: {
        officialAuthSub: profile.sub || '',
        email: profile.email || '',
        phone,
        phoneVerified: !!phone,
        nickname: profile.name || profile.username || profile.email || phone || '手机用户',
        avatarUrl: profile.picture || profile.avatar_url || '',
        role: 'user',
        status: 'active',
        loginCount: 0,
        createdAt: now,
        updatedAt: now
      }
    });
    user = {
      _id: addRes._id,
      officialAuthSub: profile.sub || '',
      email: profile.email || '',
      phone,
      phoneVerified: !!phone,
      nickname: profile.name || profile.username || profile.email || phone || '手机用户',
      role: 'user',
      status: 'active'
    };
  }

  const updateData = {
    officialAuthSub: profile.sub || user.officialAuthSub || '',
    updatedAt: now
  };
  if (phone && !user.phone) updateData.phone = phone;
  if (profile.email && !user.email) updateData.email = profile.email;
  if ((profile.name || profile.username) && (!user.nickname || user.nickname === '手机用户')) {
    updateData.nickname = profile.name || profile.username;
  }

  if (Object.keys(updateData).length > 1) {
    await db.collection('users').doc(user._id).update({ data: updateData });
    user = { ...user, ...updateData };
  }

  return user;
}

exports.main = async (event) => {
  const accessToken = String(event.accessToken || '');
  if (!accessToken) return { code: 401, message: '缺少官方登录凭证' };

  try {
    const profile = await requestAuth('/auth/v1/user/me', accessToken);
    const user = await upsertUser(profile);
    if (user.status === 'banned') return { code: 403, message: '该账号已被禁用，请联系客服' };

    const token = generateToken(String(user._id));
    await db.collection('users').doc(user._id).update({
      data: {
        token,
        tokenExpireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastLoginMethod: 'cloudbase_auth',
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
    console.error('[syncOfficialUser] error:', err);
    return { code: 500, message: err.message || '同步官方账号失败' };
  }
};
