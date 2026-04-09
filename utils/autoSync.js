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
    const cloudProfiles = await cloudSync.getCloudProfiles();
    const localMap = new Map(storage.getAllLocalProfileBundles().map((item) => [item.profileId, item]));

    for (const cloudProfile of cloudProfiles) {
      const localProfile = localMap.get(cloudProfile.profileId);
      const cloudTime = new Date(cloudProfile.lastSyncAt || 0).getTime();
      const localTime = localProfile ? new Date(localProfile.bundle?.exportedAt || 0).getTime() : 0;

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
      await cloudSync.uploadProfile(localProfile.profileId);
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
