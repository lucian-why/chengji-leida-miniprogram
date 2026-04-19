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
      headers: {
        Authorization: `Bearer ${token}`,
        'x-device-id': 'cloud-function'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function getAuthorizedUserId(event) {
  const token = event.token || '';
  const expectedUserId = event.userId || '';
  if (!token || !expectedUserId) throw new Error('请先登录');

  const legacy = await db.collection('users').where({
    token,
    tokenExpireAt: _.gt(new Date())
  }).limit(1).get();
  if (legacy.data && legacy.data[0] && String(legacy.data[0]._id) === expectedUserId) return expectedUserId;

  const official = await introspectToken(token);
  if (official && official.sub && String(official.sub) === expectedUserId) return expectedUserId;

  throw new Error('登录已过期，请重新登录');
}

function normalizeRow(row) {
  return {
    _id: row._id,
    profileId: row.profileId,
    profileName: row.profileName,
    examCount: row.examCount || 0,
    dataSize: row.dataSize || 0,
    deleted: !!row.deleted,
    deletedAt: row.deletedAt || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    lastSyncAt: row.lastSyncAt || row.updatedAt || row.createdAt || null
  };
}

exports.main = async (event) => {
  try {
    const userId = await getAuthorizedUserId(event || {});
    const showDeleted = !!event.showDeleted;
    const result = await db.collection('cloud_profiles').where({
      userId,
      deleted: showDeleted ? true : _.neq(true)
    }).orderBy('updatedAt', 'desc').limit(100).get();

    return { code: 0, data: (result.data || []).map(normalizeRow) };
  } catch (err) {
    console.error('[listCloudProfiles] error:', err);
    return { code: 401, message: err.message || '读取云端档案失败' };
  }
};
