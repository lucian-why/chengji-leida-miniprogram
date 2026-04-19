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
    const profileIds = Array.isArray(event.profileIds) ? event.profileIds.filter(Boolean) : [];
    if (!profileIds.length) return { code: -1, message: '请选择要恢复的档案' };

    const now = new Date();
    const result = await db.collection('cloud_profiles').where({
      userId,
      profileId: _.in(profileIds)
    }).update({
      data: { deleted: false, deletedAt: null, updatedAt: now }
    });

    return { code: 0, data: { updated: result.stats.updated } };
  } catch (err) {
    console.error('[restoreCloudProfiles] error:', err);
    return { code: 500, message: err.message || '恢复档案失败' };
  }
};
