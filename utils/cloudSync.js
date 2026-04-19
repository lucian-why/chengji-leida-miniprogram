const auth = require('./auth');
const storage = require('./storage');
const { callFunction } = require('./cloud');

function ensureLoggedIn() {
  const user = auth.getCurrentUser();
  if (!user) {
    throw new Error('请先登录后再使用云端同步');
  }
  return user;
}

function getAuthPayload(user) {
  return {
    token: auth.getStoredToken(),
    userId: user.id || '',
    userEmail: user.email || ''
  };
}

function unwrapResult(result, fallbackMessage) {
  if (!result) {
    throw new Error(fallbackMessage);
  }
  if (typeof result.code === 'number' && result.code !== 0) {
    throw new Error(result.message || fallbackMessage);
  }
  return result.data || result;
}

async function getCloudProfiles() {
  const user = ensureLoggedIn();
  const result = await callFunction('listCloudProfiles', {
    ...getAuthPayload(user)
  });
  const data = unwrapResult(result, '读取云端档案失败');
  return Array.isArray(data) ? data : [];
}

async function getDeletedCloudProfiles() {
  const user = ensureLoggedIn();
  const result = await callFunction('listCloudProfiles', {
    showDeleted: true,
    ...getAuthPayload(user)
  });
  const data = unwrapResult(result, '读取回收站列表失败');
  const rows = Array.isArray(data) ? data : (data?.profiles || data?.list || []);
  // 只返回标记为已删除的记录
  return rows.filter(r => r.deleted);
}

async function uploadProfile(profileId) {
  const user = ensureLoggedIn();

  // 校验数据归属
  const profiles = storage.getProfiles();
  const profileMeta = profiles.find(p => p.id === profileId);
  if (profileMeta?.isDemo) {
    return { skipped: true, reason: '示例档案不上传' };
  }
  if (profileMeta?.ownerId && profileMeta.ownerId !== user.id) {
    throw new Error('该档案不属于当前账号，无法上传');
  }

  const bundleInfo = storage.getLocalProfileBundle(profileId);
  if (!bundleInfo) {
    throw new Error('未找到要上传的本地档案');
  }

  // 示例档案不上传云端，避免多设备重复同步
  if (bundleInfo.bundle?.profile?.isDemo) {
    return { skipped: true, reason: '示例档案不上传' };
  }

  const result = await callFunction('uploadCloudProfile', {
    profileId: bundleInfo.profileId,
    profileName: bundleInfo.profileName,
    profileData: bundleInfo.bundle,
    examCount: bundleInfo.examCount,
    dataSize: bundleInfo.dataSize,
    ...getAuthPayload(user)
  });

  return unwrapResult(result, '上传到云端失败');
}

async function downloadProfile(cloudProfileId, targetProfileId, targetProfileName) {
  const user = ensureLoggedIn();
  if (!cloudProfileId) {
    throw new Error('缺少要恢复的云端档案');
  }

  const result = await callFunction('getCloudProfileData', {
    profileId: cloudProfileId,
    ...getAuthPayload(user)
  });
  const data = unwrapResult(result, '读取云端档案详情失败');

  const rawPayload = data.bundle || data.profileData || data.profile_data || data;
  const payload = JSON.parse(JSON.stringify(rawPayload));

  if (payload && payload.profile && targetProfileId) {
    payload.profile.id = targetProfileId;
    payload.profile.name = targetProfileName || payload.profile.name;
    if (Array.isArray(payload.exams)) {
      payload.exams = payload.exams.map((exam) => ({
        ...exam,
        profileId: targetProfileId
      }));
    }
  }

  storage.applyCloudProfileBundle(payload, user.id);
  return data;
}

async function deleteCloudProfiles(profileIds) {
  const user = ensureLoggedIn();
  const ids = Array.isArray(profileIds) ? profileIds.filter(Boolean) : [];
  if (!ids.length) {
    throw new Error('请选择要移入回收站的档案');
  }

  const result = await callFunction('deleteCloudProfiles', {
    profileIds: ids,
    ...getAuthPayload(user)
  });
  return unwrapResult(result, '删除云端档案失败');
}

async function restoreDeletedProfiles(profileIds) {
  const user = ensureLoggedIn();
  const ids = Array.isArray(profileIds) ? profileIds.filter(Boolean) : [];
  if (!ids.length) {
    throw new Error('请选择要恢复的档案');
  }

  const result = await callFunction('restoreCloudProfiles', {
    profileIds: ids,
    ...getAuthPayload(user)
  });
  return unwrapResult(result, '恢复档案失败');
}

async function purgeDeletedProfiles(profileIds) {
  const user = ensureLoggedIn();
  const ids = Array.isArray(profileIds) ? profileIds.filter(Boolean) : [];
  if (!ids.length) {
    throw new Error('请选择要彻底删除的档案');
  }

  const result = await callFunction('purgeDeletedProfiles', {
    profileIds: ids,
    ...getAuthPayload(user)
  });
  return unwrapResult(result, '彻底删除档案失败');
}

/**
 * 归档孤儿档案到当前账号的回收站，并从本地删除
 */
async function archiveOrphanProfiles(currentUserId) {
  const removedBundles = storage.removeOrphanProfiles(currentUserId);
  if (removedBundles.length === 0) return 0;

  let archivedCount = 0;
  for (const bundle of removedBundles) {
    try {
      const result = await callFunction('uploadCloudProfile', {
        profileId: bundle.profileId,
        profileName: bundle.profileName,
        profileData: bundle.bundle,
        examCount: bundle.examCount,
        dataSize: bundle.dataSize,
        userId: currentUserId,
        token: auth.getStoredToken(),
        deleted: true,
        deletedAt: new Date().toISOString()
      });
      archivedCount++;
    } catch (err) {
      console.warn('[cloudSync] 归档档案到回收站失败:', bundle.profileName, err && err.message || err);
    }
  }

  return archivedCount;
}

module.exports = {
  getCloudProfiles,
  getDeletedCloudProfiles,
  uploadProfile,
  downloadProfile,
  deleteCloudProfiles,
  restoreDeletedProfiles,
  purgeDeletedProfiles,
  archiveOrphanProfiles
};
