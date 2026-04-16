const storage = require('../utils/storage');
const auth = require('../utils/auth');
const cloudSync = require('../utils/cloudSync');
const vip = require('../utils/vip');

function createProfileModule(page) {
  function switchProfileByIndex(index, toastTitle) {
    const profile = page.data.profiles[index];
    if (!profile) return;

    storage.setActiveProfileId(profile.id);
    page.setData({
      activeProfileIndex: index,
      currentExamId: '',
      currentExam: null,
      showDetailPanel: false,
      showProfilePicker: false
    });
    page._saveAndReload();

    if (toastTitle) {
      wx.showToast({ title: toastTitle, icon: 'none' });
    }
  }

  function openProfilePicker() {
    if (!page.data.profiles || page.data.profiles.length <= 1) return;
    page.setData({ showProfilePicker: true });
  }

  function closeProfilePicker() {
    page.setData({ showProfilePicker: false });
  }

  function onProfileSwitch(e) {
    switchProfileByIndex(Number(e.detail.value));
  }

  function selectProfileFromSheet(e) {
    const index = Number(e.currentTarget.dataset.index);
    switchProfileByIndex(index, `已切换到 ${page.data.profiles[index].name}`);
  }

  function switchToProfile(e) {
    const index = Number(e.currentTarget.dataset.index);
    switchProfileByIndex(index, `已切换到 ${page.data.profiles[index].name}`);
  }

  function showAddProfileInput() {
    page.setData({ showAddProfile: true, newProfileName: '' });
  }

  function cancelAddProfile() {
    page.setData({ showAddProfile: false, newProfileName: '' });
  }

  function onNewProfileInput(e) {
    page.setData({ newProfileName: e.detail.value });
  }

  function confirmAddProfile() {
    const name = page.data.newProfileName.trim();
    if (!name) {
      wx.showToast({ title: '请输入档案名称', icon: 'none' });
      return;
    }

    // VIP 限制：非VIP最多2个档案
    const currentCount = storage.getProfiles().length;
    const profileCheck = vip.checkLimit('profileCount', currentCount);
    if (!profileCheck.allowed) {
      page.setData({
        showConfirmModal: true,
        confirmIcon: '👑',
        confirmIconType: 'info',
        confirmTitle: '升级 VIP 解锁更多档案',
        confirmMessage: profileCheck.reason || '免费版最多创建 2 个档案，升级 VIP 可创建更多。\n(获取 VIP：请在🐟闲置APP搜索“成绩雷达小程序VIP”)',
        confirmOkText: '获取VIP',
        confirmOkClass: 'btn-primary',
        confirmShowCancel: true,
        _confirmCallback: () => {
          if (page.showVipGuide) {
            page.showVipGuide();
          } else {
            wx.showModal({
              title: '获取官方兑换码',
              content: '请在 🐟闲置APP 中搜索关键词【成绩雷达小程序VIP】获取官方正版兑换码。点击下方按钮可直接复制搜索词。',
              confirmText: '复制搜索词',
              cancelText: '取消',
              success: (res) => {
                if (res.confirm) {
                  wx.setClipboardData({
                    data: '成绩雷达小程序VIP',
                    success: () => {
                      wx.showToast({ title: '已复制搜索词', icon: 'success' });
                    }
                  });
                }
              }
            });
          }
        }
      });
      return;
    }

    storage.createProfile(name);
    page.setData({ showAddProfile: false, newProfileName: '' });
    page._saveAndReload();
    wx.showToast({ title: '已创建', icon: 'success' });
  }

  function renameProfile(e) {
    const index = Number(e.currentTarget.dataset.index);
    const profile = page.data.profiles[index];
    if (!profile) return;
    page.setData({ showRenameModal: true, renameValue: profile.name, _renameProfileIndex: index });
  }

  function closeRenameModal() {
    page.setData({ showRenameModal: false });
  }

  function onRenameInput(e) {
    page.setData({ renameValue: e.detail.value });
  }

  function confirmRename() {
    const name = page.data.renameValue.trim();
    if (!name) {
      wx.showToast({ title: '请输入档案名称', icon: 'none' });
      return;
    }

    const profile = page.data.profiles[page.data._renameProfileIndex];
    if (!profile) return;

    storage.updateProfile(profile.id, name);
    page.setData({ showRenameModal: false });
    page._saveAndReload();
    wx.showToast({ title: '已重命名', icon: 'success' });
  }

  function confirmDeleteProfile(e) {
    const index = Number(e.currentTarget.dataset.index);
    const profile = page.data.profiles[index];
    if (!profile) return;

    page.setData({
      showConfirmModal: true,
      confirmIcon: '!',
      confirmIconType: 'danger',
      confirmTitle: '删除档案',
      confirmMessage: `确定删除“${profile.name}”及其全部考试记录吗？`,
      confirmOkText: '删除',
      confirmOkClass: 'btn-danger',
      confirmShowCancel: true,
      _confirmCallback: async () => {
        storage.deleteProfile(profile.id);
        page.setData({ activeProfileIndex: 0, currentExamId: '', currentExam: null, showDetailPanel: false });
        page._saveAndReload();

        if (page.data.isLoggedIn) {
          try {
            await cloudSync.deleteCloudProfiles([profile.id]);
            page._setSyncStatus(`已将“${profile.name}”移入云端回收站`, 'success');
          } catch (error) {
            page._setSyncStatus(error.message || '云端回收站同步失败', 'error');
          }
          wx.showToast({ title: '已删除，可在回收站恢复', icon: 'none' });
          return;
        }

        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  }

  function openNicknameModal() {
    if (!page.data.isLoggedIn || !page.data.authUser) return;
    page.setData({
      showNicknameModal: true,
      nicknameValue: page.data.authUser.nickname || ''
    });
  }

  function closeNicknameModal() {
    page.setData({
      showNicknameModal: false,
      nicknameValue: '',
      nicknameSaving: false
    });
  }

  function onNicknameInput(e) {
    page.setData({ nicknameValue: e.detail.value });
  }

  async function saveNickname() {
    const user = page.data.authUser;
    const nickname = String(page.data.nicknameValue || '').trim();
    if (!user) return;
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    try {
      page.setData({ nicknameSaving: true });
      if (user.isAdmin) {
        const nextUser = { ...user, nickname };
        wx.setStorageSync('xueji_auth_user', JSON.stringify(nextUser));
      } else {
        await auth.updateNickname(user.id, nickname);
      }
      page._syncAuthState();
      closeNicknameModal();
      wx.showToast({ title: '昵称已更新', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '修改失败', icon: 'none' });
      page.setData({ nicknameSaving: false });
    }
  }

  return {
    openProfilePicker,
    closeProfilePicker,
    onProfileSwitch,
    selectProfileFromSheet,
    switchToProfile,
    showAddProfileInput,
    cancelAddProfile,
    onNewProfileInput,
    confirmAddProfile,
    renameProfile,
    closeRenameModal,
    onRenameInput,
    confirmRename,
    confirmDeleteProfile,
    openNicknameModal,
    closeNicknameModal,
    onNicknameInput,
    saveNickname
  };
}

module.exports = createProfileModule;
