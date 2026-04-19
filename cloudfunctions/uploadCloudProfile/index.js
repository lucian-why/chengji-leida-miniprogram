const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const ENV_ID = 'chengjiguanjia-1g1twvrkd736c880';

function introspectToken(token) {
  return new Promise((resolve) => {
    const req = https.request({
      method: 'GET',
      hostname: `${ENV_ID}.api.tcloudbasegateway.com`,
      path: '/auth/v1/token/introspect',
      headers: { Authorization: `Bearer ${token}`, 'x-device-id': 'cloud-function' }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function getAuthorizedUserId(event) {
  const token = event.token || '';
  const expectedUserId = event.userId || '';
  if (!token || !expectedUserId) throw new Error('请先登录');
  const legacy = await db.collection('users').where({ token, tokenExpireAt: _.gt(new Date()) }).limit(1).get();
  if (legacy.data && legacy.data[0] && String(legacy.data[0]._id) === expectedUserId) return expectedUserId;
  const official = await introspectToken(token);
  if (official && official.sub && String(official.sub) === expectedUserId) return expectedUserId;
  throw new Error('登录已过期，请重新登录');
}

exports.main = async (event) => {
  try {
    const userId = await getAuthorizedUserId(event || {});
    const profileId = event.profileId || '';
    const profileName = String(event.profileName || '').trim() || '未命名档案';
    const profileData = event.profileData || null;
    if (!profileId || !profileData) return { code: -1, message: '档案数据不完整' };

    const now = new Date();
    const data = {
      userId,
      userEmail: event.userEmail || '',
      profileId,
      profileName,
      profileData,
      examCount: Number(event.examCount || 0),
      dataSize: Number(event.dataSize || 0),
      deleted: !!event.deleted,
      deletedAt: event.deleted ? (event.deletedAt || now) : null,
      updatedAt: now,
      lastSyncAt: now
    };

    const existing = await db.collection('cloud_profiles').where({ userId, profileId }).limit(1).get();
    if (existing.data && existing.data[0]) {
      await db.collection('cloud_profiles').doc(existing.data[0]._id).update({ data });
    } else {
      await db.collection('cloud_profiles').add({ data: { ...data, createdAt: now } });
    }

    return { code: 0, data: { profileId, profileName, lastSyncAt: now } };
  } catch (err) {
    console.error('[uploadCloudProfile] error:', err);
    return { code: 500, message: err.message || '上传到云端失败' };
  }
};
