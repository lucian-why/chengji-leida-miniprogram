const auth = require('./auth');
const cloudSync = require('./cloudSync');
const storage = require('./storage');

const AUTO_SYNC_DELAY = 2000;

let initialized = false;
let debounceTimer = null;
let syncing = false;
let pendingRun = false;
let lastLocalSnapshot = '';
let suppressDepth = 0;
let statusHandler = null;
let refreshHandler = null;

function setStatus(message = '', type = '') {
  if (typeof statusHandler === 'function') {
    statusHandler(message, type);
  }
}

function clearDebounce() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function isSuppressed() {
  return suppressDepth > 0;
}

async function runSuppressed(task) {
  suppressDepth += 1;
  storage.setSilentMode(true);
  try {
    return await task();
  } finally {
    suppressDepth = Math.max(0, suppressDepth - 1);
    storage.setSilentMode(false);
  }
}

function getLocalSnapshotKey() {
  const localProfiles = storage.getAllLocalProfileBundles();
  return JSON.stringify(localProfiles.map((item) => [
    item.profileId,
    item.profileName,
    item.examCount,
    item.dataSize
  ]));
}

function getProfileTime(profile) {
  const timestamp = new Date(profile?.deletedAt || profile?.lastSyncAt || profile?.updatedAt || profile?.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function performFullSync(reason) {
  if (syncing) {
    pendingRun = true;
    return;
  }

  const user = auth.getCurrentUser();
  if (!user) {
    clearDebounce();
    setStatus('', '');
    return;
  }

  syncing = true;
  clearDebounce();
  setStatus(reason === 'login' ? '正在同步云端档案…' : '正在同步最新变更…', 'pending');

  try {
    const deletedCloudProfiles = await cloudSync.getDeletedCloudProfiles();
    const deletedCloudMap = new Map(deletedCloudProfiles.map((item) => [item.profileId, item]));
    const appliedDeletedIds = new Set();
    let localMap = new Map(storage.getAllLocalProfileBundles().map((item) => [item.profileId, item]));

    for (const deletedProfile of deletedCloudProfiles) {
      const localProfile = localMap.get(deletedProfile.profileId);
      if (!localProfile) continue;

      const cloudDeleteTime = getProfileTime(deletedProfile);
      const localTime = new Date(localProfile.localUpdatedAt || localProfile.bundle?.exportedAt || 0).getTime();
      if (!localTime || cloudDeleteTime >= localTime) {
        await runSuppressed(async () => {
          storage.removeProfilesByIds([deletedProfile.profileId]);
        });
        appliedDeletedIds.add(deletedProfile.profileId);
      }
    }

    const cloudProfiles = await cloudSync.getCloudProfiles();
    localMap = new Map(storage.getAllLocalProfileBundles().map((item) => [item.profileId, item]));

    for (const cloudProfile of cloudProfiles) {
      if (appliedDeletedIds.has(cloudProfile.profileId)) continue;
      const localProfile = localMap.get(cloudProfile.profileId);
      const cloudTime = new Date(cloudProfile.lastSyncAt || 0).getTime();
      const localTime = localProfile ? new Date(localProfile.localUpdatedAt || localProfile.bundle?.exportedAt || 0).getTime() : 0;

      if (!localProfile || cloudTime > localTime) {
        try {
          await runSuppressed(async () => {
            await cloudSync.downloadProfile(
              cloudProfile.profileId,
              cloudProfile.profileId,
              cloudProfile.profileName
            );
          });
        } catch (downloadErr) {
          // 单个档案下载失败不阻断整体同步（可能是已删除的档案）
          console.warn('[autoSync] download failed:', cloudProfile.profileId, downloadErr.message);
        }
      }
    }

    if (typeof refreshHandler === 'function') {
      refreshHandler();
    }

    const localProfiles = storage.getAllLocalProfileBundles();
    for (const localProfile of localProfiles) {
      const deletedProfile = deletedCloudMap.get(localProfile.profileId);
      if (deletedProfile && getProfileTime(deletedProfile) >= new Date(localProfile.localUpdatedAt || 0).getTime()) {
        continue;
      }
      try {
        await cloudSync.uploadProfile(localProfile.profileId);
      } catch (uploadErr) {
        console.warn('[autoSync] upload failed for', localProfile.profileId, uploadErr.message);
      }
    }

    lastLocalSnapshot = getLocalSnapshotKey();
    setStatus('已开启自动云同步', 'success');
  } catch (error) {
    setStatus(error.message || '自动云同步失败', 'error');
  } finally {
    syncing = false;
    if (pendingRun) {
      pendingRun = false;
      await performFullSync('queued');
    }
  }
}

function scheduleAutoSync(change = {}) {
  if (isSuppressed()) return;
  if (!auth.getCurrentUser()) return;

  const snapshot = getLocalSnapshotKey();
  if (snapshot === lastLocalSnapshot) {
    return;
  }

  setStatus('检测到本地改动，稍后自动同步…', 'info');
  clearDebounce();
  debounceTimer = setTimeout(() => {
    performFullSync('local-change');
  }, AUTO_SYNC_DELAY);
}

function initAutoSync(options = {}) {
  statusHandler = options.onStatusChange || statusHandler;
  refreshHandler = options.onRefresh || refreshHandler;

  if (initialized) return;

  storage.setStorageSyncHooks({
    onChange: scheduleAutoSync,
    isSuppressed
  });

  initialized = true;
}

async function syncAfterLogin() {
  await performFullSync('login');
}

async function syncOnShow() {
  await performFullSync('focus');
}

function handleLogoutAutoSync() {
  pendingRun = false;
  syncing = false;
  lastLocalSnapshot = '';
  clearDebounce();
  setStatus('', '');
}

module.exports = {
  initAutoSync,
  syncAfterLogin,
  syncOnShow,
  handleLogoutAutoSync
};
