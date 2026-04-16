/**
 * 成绩雷达 - Main page (refactored: thin glue layer)
 * Architecture: module factory + Object.assign mixin in onLoad
 */

const storage = require('../../utils/storage');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');
const cloudSync = require('../../utils/cloudSync');
const autoSync = require('../../utils/autoSync');
const ai = require('../../utils/ai');
const vip = require('../../utils/vip');

const defs = require('../../modules/defs');

const createExamModule = require('../../modules/examModule');
const createScoreModule = require('../../modules/scoreModule');
const createBatchModule = require('../../modules/batchModule');
const createChartModule = require('../../modules/chartModule');
const createProfileModule = require('../../modules/profileModule');
const createModalModule = require('../../modules/modalModule');
const createReportModule = require('../../modules/reportModule');
const createDataManager = require('../../modules/dataManager');

let _modulesRegistered = false;

function getAuthModeMeta(mode) {
  if (mode === 'sms_login') return { title: '验证码登录', submitText: '登录' };
  if (mode === 'register') return { title: '注册账号', submitText: '注册' };
  if (mode === 'resetpwd') return { title: '找回密码', submitText: '重置密码' };
  return { title: '账号登录', submitText: '登录' };
}

Page({
  data: {
    ...defs._global,
    ...defs.exam,
    ...defs.score,
    ...defs.batch,
    ...defs.chart,
    ...defs.profile,
    ...defs.modal,
    ...defs.report,
    ...defs.auth,

    // AI 分析
  aiAnalysisHtml: '',
  aiAnalysisStatus: 'default',
  aiAnalysisBusy: false,
  aiAnalysisSource: '',
  aiAnalysisFallbackReason: '',
  // VIP 配额状态
  isVip: false,
  aiQuotaMessage: '',
  aiQuotaUsed: 0,
  aiQuotaLimit: 2,
  // 邀请码
  inviteCode: '',
  inviteCodeBusy: false,
  inviteCodeMessage: '',
  inviteCodeMessageType: ''
  },

  onLoad() {
    if (!_modulesRegistered) {
      _modulesRegistered = true;
      Object.assign(this, createExamModule(this));
      Object.assign(this, createScoreModule(this));
      Object.assign(this, createBatchModule(this));
      Object.assign(this, createChartModule(this));
      Object.assign(this, createProfileModule(this));
      Object.assign(this, createModalModule(this));
      Object.assign(this, createReportModule(this));
      Object.assign(this, createDataManager(this));
    }

    storage.migrateProfilesIfNeeded();
    autoSync.initAutoSync({
      onStatusChange: (message, type) => this._setSyncStatus(message, type),
      onRefresh: () => this._loadData()
    });
    this._loadData();
    this._syncAuthState();
    this._checkFirstLaunch();
  },

  async onShow() {
    this._loadData();
    // 已登录时优先从云端拉取最新用户信息（昵称等），确保跨端同步
    if (auth.getCurrentUser()) {
      await auth.refreshUser().catch(() => {});
    }
    this._syncAuthState();
    autoSync.syncOnShow();
  },

  onUnload() {
    if (this._authCountdownTimer) {
      clearInterval(this._authCountdownTimer);
      this._authCountdownTimer = null;
    }
  },

  onShareAppMessage() {
    const profile = this.data.profiles[this.data.activeProfileIndex];
    return {
      title: '成绩雷达 - ' + (profile ? profile.name : '成绩管理'),
      path: '/pages/index/index'
    };
  },

  _loadData() {
    const profiles = storage.getProfiles();
    const activeId = storage.getActiveProfileId();
    let activeIndex = profiles.findIndex(p => p.id === activeId);
    if (activeIndex === -1) activeIndex = 0;

    const profilesWithCount = profiles.map(p => {
      const exams = storage.getExams(p.id);
      return { ...p, examCount: exams.length };
    });

    const profileNames = profilesWithCount.map(p => p.name);
    const currentProfileId = profilesWithCount[activeIndex] ? profilesWithCount[activeIndex].id : '';
    const exams = storage.getExams(currentProfileId).sort(fmt.compareExamDateDesc);

    exams.forEach(e => {
      e.autoTotalScore = fmt.getTotalScore(e.subjects);
      e.totalScore = fmt.getDisplayTotalScore(e);
      e.totalScoreMismatch = fmt.hasManualTotalMismatch(e);
    });

    const subjectNames = fmt.uniqueSubjectNames(exams);
    const hasDemoData = exams.some(e => e.id.startsWith('demo_')) && exams.some(e => !e.id.startsWith('demo_'));

    this.setData({
      profiles: profilesWithCount,
      activeProfileIndex: activeIndex,
      profileNames,
      exams,
      subjectNames,
      hasDemoData,
      showScoreView: this.data.showScoreView || false,
      showDetailPanel: this.data.showDetailPanel || false
    });

    if (!this.data.currentExamId && exams.length > 0) {
      this.setData({
        currentExamId: exams[0].id,
        showScoreView: this.data.showScoreView || false
      });
    }

    this._refreshCurrentExam();
    this._refreshAIStatus();
  },

  // ======================== AI 分析 ========================

  /**
   * 仅刷新 AI 分析卡片的显示状态（不发起 AI 请求）
   * 用于页面初始化时，快速展示正确的按钮状态
   */
  _refreshAIStatus() {
    const profileId = this._getActiveProfileId();
    if (!profileId || profileId === '_none') {
      this.setData({ aiAnalysisStatus: 'default', aiAnalysisBusy: false });
      return;
    }
    if (!auth.getCurrentUser()) {
      this.setData({ aiAnalysisStatus: 'login', aiAnalysisBusy: false });
      return;
    }
    const exams = storage.getExams(profileId);
    if (exams.length < 2) {
      this.setData({ aiAnalysisStatus: 'notEnough', aiAnalysisBusy: false });
      return;
    }
    // 有足够数据且已登录：如果之前有缓存结果就显示成功，否则显示 default（等待用户主动触发）
    if (this.data.aiAnalysisHtml && this.data.aiAnalysisStatus === 'success') {
      return; // 保持当前成功状态
    }
    this.setData({ aiAnalysisStatus: 'default', aiAnalysisBusy: false });
  },

  async _refreshAIAnalysis({ force } = {}) {
    const profileId = this._getActiveProfileId();
    if (!profileId || profileId === '_none') {
      // 没有活跃档案时也设置默认状态，避免 status 为空
      this.setData({ aiAnalysisStatus: 'default', aiAnalysisBusy: false });
      return;
    }

    // 前置检查1：登录状态
    if (!auth.getCurrentUser()) {
      this.setData({ aiAnalysisStatus: 'login', aiAnalysisBusy: false });
      return;
    }

    // 前置检查1.5：VIP 配额检查（非VIP每天限2次）
    const aiQuotaCheck = vip.checkLimit('aiAnalysis');
    if (!aiQuotaCheck.allowed) {
      this.setData({
        aiAnalysisStatus: 'quotaExceeded',
        aiAnalysisBusy: false,
        aiQuotaMessage: aiQuotaCheck.reason || '今日AI分析次数已用完',
        aiQuotaUsed: aiQuotaCheck.used || 0,
        aiQuotaLimit: aiQuotaCheck.limit || 2
      });
      return;
    }

    // 前置检查2：考试数据量
    const exams = storage.getExams(profileId);
    if (exams.length < 2) {
      this.setData({ aiAnalysisStatus: 'notEnough', aiAnalysisBusy: false });
      return;
    }

    // 防止重复调用：如果正在分析且非强制刷新，跳过
    if (this.data.aiAnalysisBusy && !force) {
      console.log('[AI] 已在分析中，跳过自动刷新');
      return;
    }

    // 设置加载状态
    console.log('[AI] 开始分析, force:', force);
    this.setData({ aiAnalysisStatus: 'loading', aiAnalysisBusy: true });

    // 安全网：最多 30 秒后强制降级到本地分析，防止永远卡在 loading
    const safetyTimer = setTimeout(() => {
      if (this.data.aiAnalysisBusy) {
        console.warn('[AI] 安全网触发：30s 超时，降级到本地分析');
        this._showLocalFallback(profileId, 'AI 服务响应超时，已切换到基础统计');
      }
    }, 30000);

    try {
      const result = await ai.refreshAIAnalysis({ force: !!force });

      // 请求被覆盖，恢复到之前的有效状态
      if (result.status === 'cancelled') {
        this.setData({
          aiAnalysisStatus: this.data.aiAnalysisHtml ? 'success' : 'default',
          aiAnalysisBusy: false
        });
        clearTimeout(safetyTimer);
        return;
      }

      // 成功：设置 HTML 内容
      if (result.status === 'success' && result.html) {
        vip.consumeQuota('aiAnalysis');  // 消耗一次AI分析配额
        this.setData({
          aiAnalysisHtml: result.html,
          aiAnalysisStatus: 'success',
          aiAnalysisSource: result.meta?.source || '',
          aiAnalysisFallbackReason: result.meta?.fallbackReason || ''
        });
      } else {
        // AI 返回了非成功状态，尝试本地兜底
        this._showLocalFallback(profileId, 'AI 暂时不可用，已切换到基础统计');
      }
    } catch (err) {
      console.error('[AI] 分析异常:', err);
      this._showLocalFallback(profileId, 'AI 服务异常，已切换到基础统计');
    } finally {
      clearTimeout(safetyTimer);
      this.setData({ aiAnalysisBusy: false });
    }
  },

  /**
   * 本地兜底分析：无论 AI 是否可用，用户总能看到成绩统计
   */
  _showLocalFallback(profileId, reason) {
    try {
      const exams = storage.getExams(profileId);
      if (exams.length < 2) {
        this.setData({ aiAnalysisStatus: 'notEnough', aiAnalysisBusy: false });
        return;
      }
      const payload = ai.buildAnalysisPayload(exams);
      const localText = ai.buildLocalFallbackAnalysis(payload);
      const html = ai.formatAnalysisHtml(localText);
      this.setData({
        aiAnalysisHtml: html,
        aiAnalysisStatus: 'success',
        aiAnalysisSource: 'local-fallback',
        aiAnalysisFallbackReason: reason || 'AI 服务暂不可用，当前为基础统计结果',
        aiAnalysisBusy: false
      });
      console.log('[AI] 已降级到本地分析');
    } catch (fallbackErr) {
      console.error('[AI] 本地分析也失败:', fallbackErr);
      this.setData({ aiAnalysisStatus: 'error', aiAnalysisBusy: false });
    }
  },

  onAIAction() {
    const s = this.data.aiAnalysisStatus;
    console.log('[AI] onAIAction clicked, status:', s, 'busy:', this.data.aiAnalysisBusy);
    if (s === 'login') {
      this.openAuthModal();
      return;
    }
    // 配额已用完，引导升级
    if (s === 'quotaExceeded') {
      this.setData({
        showConfirmModal: true,
        confirmIcon: '👑',
        confirmIconType: 'info',
        confirmTitle: '今日分析次数已用完',
        confirmMessage: '免费版每天可使用 2 次 AI 分析，升级 VIP 解锁无限次数。',
        confirmOkText: '获取VIP',
        confirmOkClass: 'btn-primary',
        confirmShowCancel: true,
        _confirmCallback: () => { 
          this.showVipGuide();
        }
      });
      return;
    }
    // 如果卡在 loading 状态超过一定时间，允许用户再次点击强制重新开始
    if (this.data.aiAnalysisBusy && s !== 'loading') {
      console.log('[AI] 已在分析中，忽略重复点击');
      return;
    }
    // 强制刷新：重置 busy 状态后再调用
    this.setData({ aiAnalysisBusy: false }, () => {
      this._refreshAIAnalysis({ force: true });
    });
  },

  showVipGuide() {
    console.log('[VIP] showVipGuide triggered');
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
  },

  onShowLocalAnalysis() {
    const profileId = this._getActiveProfileId();
    if (profileId) {
      this._showLocalFallback(profileId, '用户选择查看基础统计');
    }
  },

  // ======================== AI 对话入口 ========================

  /**
   * 入口1：从 AI 分析报告进入对话
   */
  openAIChatFromReport() {
    const user = auth.getCurrentUser();
    if (!user) {
      this.openAuthModal();
      return;
    }

    // 获取当前分析文本（从缓存的原始文本获取，不是 HTML）
    const analysisText = ai._lastAnalysisText || '';
    const encodedText = analysisText ? encodeURIComponent(analysisText) : '';

    wx.navigateTo({
      url: `/pages/ai-chat/ai-chat?source=report&analysisText=${encodedText}`
    });
  },

  /**
   * 入口2：从科目对比进入对话
   */
  openAIChatFromCompare() {
    const user = auth.getCurrentUser();
    if (!user) {
      this.openAuthModal();
      return;
    }

    // 构建科目对比数据
    const currentExamId = this.data.currentExamId;
    const selectedCompareIds = (this.data.radarExams || [])
      .filter(e => e.selected)
      .map(e => e.id);

    const compareData = ai.buildCompareData(currentExamId, selectedCompareIds);
    const encodedData = compareData ? encodeURIComponent(JSON.stringify(compareData)) : '';

    wx.navigateTo({
      url: `/pages/ai-chat/ai-chat?source=compare&compareData=${encodedData}`
    });
  },

  _saveAndReload() {
    this._loadData();
  },

  _getActiveProfileId() {
    return this.data.profiles[this.data.activeProfileIndex]
      ? this.data.profiles[this.data.activeProfileIndex].id
      : '';
  },

  switchTab(e) {
    var tab;
    if (e && e.currentTarget && e.currentTarget.dataset) {
      tab = e.currentTarget.dataset.tab;
    } else {
      tab = e;
    }
    if (!tab) return;
    this.setData({ currentTab: tab, showDetailPanel: false, showScoreView: false });
    if (tab === 'trend') {
      this.$nextTick && this.$nextTick(() => this._drawChart());
      setTimeout(() => this._drawChart(), 300);
    }
  },

  noop() {},

  // ======================== 手势滑动区域 ========================
  _touchStartX: 0,
  _touchStartY: 0,
  _touchMoving: false,
  _tabIndex: { exam: 0, trend: 1, settings: 2 },
  _tabKeys: ['exam', 'trend', 'settings'],

  // ======================== 面板滑动区域 ========================
  _panelTouchStartX: 0,
  _panelTouchStartY: 0,
  _panelTouchMoving: false,

  onPanelTouchStart(e) {
    this._panelTouchStartX = e.touches[0].clientX;
    this._panelTouchStartY = e.touches[0].clientY;
    this._panelTouchMoving = false;
  },

  onPanelTouchMove(e) {
    this._panelTouchMoving = true;
  },

  onPanelTouchEnd(e) {
    if (!this._panelTouchMoving) return;
    var endX = e.changedTouches[0].clientX;
    var endY = e.changedTouches[0].clientY;
    var deltaY = Math.abs(endY - this._panelTouchStartY);

    if (deltaY > 50) return;

    var deltaX = endX - this._panelTouchStartX;
    var THRESHOLD = 80;

    if (deltaX < -THRESHOLD) {
      this.setData({ _panelSlidingOut: true });
      setTimeout(() => {
        this.setData({
          showDetailPanel: false,
          showScoreView: true,
          _panelSlidingOut: false
        });
      }, 250);
    }
  },

  closeScoreView() {
    this.setData({ showScoreView: false });
  },

  onTouchStart(e) {
    this._touchStartX = e.touches[0].clientX;
    this._touchStartY = e.touches[0].clientY;
    this._touchMoving = false;
  },

  onTouchMove(e) {
    this._touchMoving = true;
  },

  onTouchEnd(e) {
    if (!this._touchMoving) return;
    if (this.data.showScoreView) return;
    var endX = e.changedTouches[0].clientX;
    var endY = e.changedTouches[0].clientY;
    var deltaY = Math.abs(endY - this._touchStartY);

    if (deltaY > 50) return;

    var deltaX = endX - this._touchStartX;
    var THRESHOLD = 80;

    if (deltaX < -THRESHOLD) {
      var cur = this._tabIndex[this.data.currentTab];
      if (cur < 2) {
        this.setData({
          _slideDirection: 'left',
          currentTab: this._tabKeys[cur + 1],
          showDetailPanel: false,
          showScoreView: false
        });
        if (this._tabKeys[cur + 1] === 'trend') {
          this.$nextTick && this.$nextTick(() => this._drawChart());
          setTimeout(() => this._drawChart(), 300);
        }
        setTimeout(() => { this.setData({ _slideDirection: '' }); }, 300);
      }
    } else if (deltaX > THRESHOLD) {
      var cur2 = this._tabIndex[this.data.currentTab];
      if (cur2 > 0) {
        this.setData({
          _slideDirection: 'right',
          currentTab: this._tabKeys[cur2 - 1],
          showDetailPanel: false,
          showScoreView: false
        });
        if (this._tabKeys[cur2 - 1] === 'trend') {
          this.$nextTick && this.$nextTick(() => this._drawChart());
          setTimeout(() => this._drawChart(), 300);
        }
        setTimeout(() => { this.setData({ _slideDirection: '' }); }, 300);
      }
    }
  },

  _refreshAuthModeMeta(mode) {
    const currentMode = mode || this.data.authMode;
    const meta = getAuthModeMeta(currentMode);
    this.setData({
      authTitle: meta.title,
      authSubmitText: meta.submitText,
      authShowPasswordSection: currentMode === 'login' || currentMode === 'register',
      authShowCodeSection: currentMode === 'sms_login' || currentMode === 'register' || currentMode === 'resetpwd',
      authShowResetSection: currentMode === 'resetpwd',
      authShowLoginLink: currentMode !== 'login',
      authShowSmsLink: currentMode !== 'sms_login',
      authShowRegisterLink: currentMode !== 'register',
      authShowResetLink: currentMode !== 'resetpwd'
    });
  },

  _syncAuthState() {
    const user = auth.getCurrentUser();
    let vipExpireDays = -1;
    let vipExpireDateStr = '';
    let isVipUser = vip.isVip(user);
    
    if (isVipUser) {
      if (user && user.role === 'admin') {
        vipExpireDays = 9999;
      } else if (user && user.vipExpireAt) {
        const expireTime = new Date(user.vipExpireAt).getTime();
        const now = Date.now();
        if (expireTime > now) {
          vipExpireDays = Math.ceil((expireTime - now) / (1000 * 60 * 60 * 24));
          const date = new Date(expireTime);
          vipExpireDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        } else {
          isVipUser = false;
        }
      } else {
         // 旧版永久 VIP 兼容
         vipExpireDays = 9999;
      }
    }

    this.setData({
      authUser: user,
      isLoggedIn: !!user,
      authDisplayName: user ? (user.nickname || user.email || user.phone || '已登录') : '未登录',
      authDisplayDesc: user
        ? '当前账号已登录，系统会自动同步云端数据。'
        : '登录后将自动同步到云端，多设备同账号保持一致。',
      isVip: isVipUser,
      vipExpireDays: vipExpireDays,
      vipExpireDateStr: vipExpireDateStr
    });
  },

  _setAuthStatus(message, type) {
    this.setData({
      authStatusMessage: message || '',
      authStatusType: type || ''
    });
  },

  _setSyncStatus(message, type) {
    this.setData({
      syncStatusMessage: message || '',
      syncStatusType: type || ''
    });
  },

  _formatSyncTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
  },

  _resetAuthForm(mode, message) {
    const nextMode = mode || 'login';
    const meta = getAuthModeMeta(nextMode);
    this.setData({
      authMode: nextMode,
      authTitle: meta.title,
      authSubmitText: meta.submitText,
      authSendCodeText: '发送验证码',
      authAccount: '',
      authCode: '',
      authPassword: '',
      authConfirmPassword: '',
      authNewPassword: '',
      authSendingCode: false,
      authCountdown: 0,
      authPasswordVisible: false,
      authNewPasswordVisible: false,
      authConfirmPasswordVisible: false,
      authStatusMessage: message || '',
      authStatusType: message ? 'info' : ''
    });
    this._refreshAuthModeMeta(nextMode);
  },

  openAuthModal() {
    this._resetAuthForm('login', '登录后可启用后续的云端同步能力。');
    this.setData({
      showAuthModal: true,
      canvasHidden: true   // 隐藏原生 canvas，避免遮挡弹窗
    });
  },

  closeAuthModal() {
    this.setData({
      showAuthModal: false,
      canvasHidden: false  // 恢复 canvas 显示
    });
    this._setAuthStatus('', '');
    // canvas 重建后需要重新绘制图表
    setTimeout(() => {
      if (this._drawChart) this._drawChart();
    }, 300);
  },

  // 登录模式切换快捷方法
  switchToSmsLogin() {
    this._resetAuthForm('sms_login', '请输入手机号或邮箱，发送验证码登录。');
  },

  switchToPasswordLogin() {
    this._resetAuthForm('login', '');
  },

  switchToRegister() {
    this._resetAuthForm('register', '请输入手机号或邮箱，发送验证码后设置密码完成注册。');
  },

  switchToResetPwd() {
    this._resetAuthForm('resetpwd', '请输入注册邮箱或手机号，发送验证码后设置新密码。');
  },

  // 发送验证码别名
  handleSendCode() {
    this.sendAuthCode();
  },

  // 提交登录别名
  handleAuthSubmit() {
    this.submitAuth();
  },

  // 退出登录别名
  handleLogout() {
    this.logout();
  },

  // 昵称弹窗
  openNicknameModal() {
    const user = auth.getCurrentUser();
    this.setData({
      showNicknameModal: true,
      nicknameValue: user ? (user.nickname || '') : ''
    });
  },

  closeNicknameModal() {
    this.setData({ showNicknameModal: false, nicknameValue: '' });
  },

  onNicknameInput(e) {
    this.setData({ nicknameValue: e.detail.value });
  },

  async saveNickname() {
    const newName = (this.data.nicknameValue || '').trim();
    if (!newName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    const user = auth.getCurrentUser();
    if (!user || !user.id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    try {
      this.setData({ nicknameSaving: true });
      await auth.updateNickname(user.id, newName);
      this._syncAuthState();
      this.closeNicknameModal();
      wx.showToast({ title: '昵称已更新', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '更新失败', icon: 'none' });
    } finally {
      this.setData({ nicknameSaving: false });
    }
  },

  // 回收站选中切换（wxml 绑定别名）
  toggleDeletedProfile(e) {
    const index = e.currentTarget.dataset.index;
    const list = this.data.deletedCloudProfiles;
    if (!list || index >= list.length) return;

    list[index]._selected = !list[index]._selected;
    this.setData({ deletedCloudProfiles: list });

    const selectedIds = list.filter(item => item._selected).map(item => item.profileId);
    this.setData({ deletedProfileSelection: selectedIds });
  },

  switchAuthMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this._resetAuthForm(mode, '');
  },

  onAuthInput(e) {
    const rawField = e.currentTarget.dataset.field;
    const fieldMap = {
      account: 'authAccount',
      code: 'authCode',
      password: 'authPassword',
      newPassword: 'authNewPassword',
      confirmPassword: 'authConfirmPassword'
    };
    const dataKey = fieldMap[rawField] || rawField;
    this.setData({ [dataKey]: e.detail.value });
  },

  toggleAuthPasswordVisible(e) {
    const rawField = e.currentTarget.dataset.field;
    const fieldMap = {
      password: 'authPasswordVisible',
      newPassword: 'authNewPasswordVisible',
      confirmPassword: 'authConfirmPasswordVisible'
    };
    const dataKey = fieldMap[rawField] || rawField;
    this.setData({ [dataKey]: !this.data[dataKey] });
  },

  _startAuthCountdown() {
    if (this._authCountdownTimer) {
      clearInterval(this._authCountdownTimer);
    }

    this.setData({ authCountdown: 60, authSendingCode: true, authSendCodeText: '60s' });
    this._authCountdownTimer = setInterval(() => {
      const next = this.data.authCountdown - 1;
      if (next <= 0) {
        clearInterval(this._authCountdownTimer);
        this._authCountdownTimer = null;
        this.setData({ authCountdown: 0, authSendingCode: false, authSendCodeText: '发送验证码' });
        return;
      }
      this.setData({ authCountdown: next, authSendCodeText: next + 's' });
    }, 1000);
  },

  async sendAuthCode() {
    const account = this.data.authAccount;
    const type = auth.detectAccountType(account);

    if (type === 'admin') {
      this._setAuthStatus('管理员账号不支持验证码操作', 'error');
      return;
    }

    if (type === 'unknown') {
      this._setAuthStatus('请输入正确的邮箱地址或手机号', 'error');
      return;
    }

    try {
      this._setAuthStatus('正在发送验证码...', 'pending');
      if (type === 'phone') await auth.sendSmsCode(account, this.data.authMode);
      else await auth.sendEmailCode(account);
      this._setAuthStatus('验证码已发送，请注意查收。', 'success');
      this._startAuthCountdown();
    } catch (error) {
      this._setAuthStatus(error.message || '验证码发送失败', 'error');
      this.setData({ authSendingCode: false, authCountdown: 0, authSendCodeText: '发送验证码' });
    }
  },

  async handleWxGetPhoneNumber(e) {
    const phoneCode = (e.detail && e.detail.code) || '';
    try {
      this.setData({ authSubmitting: true });
      this._setAuthStatus('正在微信登录...', 'pending');
      await auth.wxLogin(phoneCode);
      this._syncAuthState();

      const user = auth.getCurrentUser();
      if (user && user.id) {
        const { hasOrphans, orphanProfiles, orphanExamCount } = storage.detectOrphanProfiles(user.id);
        if (hasOrphans) {
          const profileNames = orphanProfiles.map(p => p.name).join('、');
          this._showOrphanDataDialog(profileNames, orphanExamCount, user.id);
        }
      }

      await autoSync.syncAfterLogin();
      this._refreshAIStatus();
      this._setAuthStatus('登录成功', 'success');
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => this.closeAuthModal(), 500);
    } catch (error) {
      this._setAuthStatus(error.message || '微信登录失败', 'error');
    } finally {
      this.setData({ authSubmitting: false });
    }
  },

  async submitAuth() {
    const mode = this.data.authMode;
    const account = this.data.authAccount;
    const password = this.data.authPassword;
    const code = this.data.authCode;
    const newPassword = this.data.authNewPassword;
    const confirmPassword = this.data.authConfirmPassword;

    try {
      this.setData({ authSubmitting: true });

      if (mode === 'login') {
        this._setAuthStatus('正在登录...', 'pending');
        await auth.passwordLogin(account, password);
      } else if (mode === 'sms_login') {
        this._setAuthStatus('正在登录...', 'pending');
        await auth.codeLogin(account, code);
      } else if (mode === 'register') {
        this._setAuthStatus('正在注册...', 'pending');
        await auth.register(account, code, password);
      } else if (mode === 'resetpwd') {
        if (newPassword !== confirmPassword) {
          throw new Error('两次输入的密码不一致');
        }
        this._setAuthStatus('正在重置密码...', 'pending');
        await auth.resetPassword(account, code, newPassword);
      }

      this._syncAuthState();

      // 登录后检测孤儿档案
      const user = auth.getCurrentUser();
      if (user && user.id) {
        const { hasOrphans, orphanProfiles, orphanExamCount } = storage.detectOrphanProfiles(user.id);
        if (hasOrphans) {
          const profileNames = orphanProfiles.map(p => p.name).join('、');
          this._showOrphanDataDialog(profileNames, orphanExamCount, user.id);
        }
      }

      await autoSync.syncAfterLogin();
      // 登录后重新检查 AI 分析状态
      if (typeof this._refreshAnalysis === 'function') {
        this._refreshAIStatus();
      }
      this._setAuthStatus(mode === 'resetpwd' ? '密码已重置' : '操作成功', 'success');
      wx.showToast({ title: mode === 'resetpwd' ? '重置成功' : '登录成功', icon: 'success' });
      setTimeout(() => this.closeAuthModal(), 500);
    } catch (error) {
      this._setAuthStatus(error.message || '操作失败', 'error');
    } finally {
      this.setData({ authSubmitting: false });
    }
  },

  logout() {
    auth.signOut();
    autoSync.handleLogoutAutoSync();
    this._syncAuthState();
    this.setData({ aiAnalysisStatus: 'login', aiAnalysisHtml: '', aiAnalysisBusy: false, aiAnalysisSource: '', aiAnalysisFallbackReason: '' });
    this._setSyncStatus('', '');
    wx.showToast({ title: '已退出登录', icon: 'none' });
  },

  uploadToCloud() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    const profile = this.data.profiles[this.data.activeProfileIndex];
    if (!profile) {
      wx.showToast({ title: '当前没有可上传的档案', icon: 'none' });
      return;
    }

    this.data._confirmCallback = () => this._performUploadToCloud(profile);
    this.setData({
      showConfirmModal: true,
      confirmIcon: '☁',
      confirmIconType: 'info',
      confirmTitle: '上传到云端',
      confirmMessage: `是否要上传“${profile.name}”档案到云端？`,
      confirmOkText: '确定上传',
      confirmOkClass: 'btn-primary',
      confirmShowCancel: true
    });
  },

  async _performUploadToCloud(profile) {
    try {
      this.setData({ syncBusy: true });
      this._setSyncStatus('正在上传到云端...', 'pending');
      const result = await cloudSync.uploadProfile(profile.id);
      this.setData({
        syncLastAt: result.lastSyncAt || new Date().toISOString()
      });
      this._setSyncStatus('已上传到云端', 'success');
      wx.showToast({ title: '上传成功', icon: 'success' });
    } catch (error) {
      this._setSyncStatus(error.message || '上传失败', 'error');
      wx.showToast({ title: '上传失败', icon: 'none' });
    } finally {
      this.setData({ syncBusy: false });
    }
  },

  async restoreFromCloud() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    const profile = this.data.profiles[this.data.activeProfileIndex];
    if (!profile) {
      wx.showToast({ title: '当前没有可恢复的档案', icon: 'none' });
      return;
    }

    try {
      this.setData({ syncBusy: true });
      this._setSyncStatus('正在读取云端档案列表...', 'pending');
      const cloudProfiles = await cloudSync.getCloudProfiles();
      if (!cloudProfiles.length) {
        throw new Error('云端还没有可恢复的档案');
      }

      this.setData({
        showCloudRestorePicker: true,
        cloudRestoreProfiles: cloudProfiles.map((item) => ({
          profileId: item.profileId,
          profileName: item.profileName || '未命名档案',
          examCount: Number(item.examCount || 0),
          lastSyncLabel: this._formatSyncTime(item.lastSyncAt || item.updatedAt || item.createdAt)
        }))
      });
      this._setSyncStatus('请选择要恢复的云端档案', 'info');
    } catch (error) {
      this._setSyncStatus(error.message || '读取云端档案失败', 'error');
      wx.showToast({ title: '读取失败', icon: 'none' });
    } finally {
      this.setData({ syncBusy: false });
    }
  },

  closeCloudRestorePicker() {
    this.setData({
      showCloudRestorePicker: false,
      cloudRestoreProfiles: []
    });
  },

  async selectCloudRestoreProfile(e) {
    const cloudProfileId = e.currentTarget.dataset.profileId;
    const cloudProfileName = e.currentTarget.dataset.profileName || '';
    const profile = this.data.profiles[this.data.activeProfileIndex];
    if (!cloudProfileId || !profile) return;

    try {
      this.closeCloudRestorePicker();
      this.setData({ syncBusy: true });
      this._setSyncStatus('正在从云端恢复...', 'pending');
      await cloudSync.downloadProfile(cloudProfileId, profile.id, profile.name);
      this._loadData();
      this._setSyncStatus(`已恢复“${cloudProfileName || profile.name}”到当前档案`, 'success');
      wx.showToast({ title: '恢复成功', icon: 'success' });
    } catch (error) {
      this._setSyncStatus(error.message || '恢复失败', 'error');
      wx.showToast({ title: '恢复失败', icon: 'none' });
    } finally {
      this.setData({ syncBusy: false });
    }
  },

  async openRecycleBin() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    try {
      this.setData({ recycleBusy: true });
      this._setSyncStatus('正在读取回收站...', 'pending');
      const deletedProfiles = await cloudSync.getDeletedCloudProfiles();
      this.setData({
        showRecycleBinPicker: true,
        deletedCloudProfiles: deletedProfiles.map((item) => {
          const deletedTime = item.deletedAt || item.updatedAt || item.createdAt;
          const daysLeft = deletedTime ? Math.max(0, 30 - Math.floor((Date.now() - new Date(deletedTime).getTime()) / 86400000)) : 30;
          const sizeBytes = Number(item.dataSize || item.data_size || 0);
          const dataSizeText = sizeBytes < 1024 ? `${sizeBytes} B` : (sizeBytes < 1048576 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${(sizeBytes / 1048576).toFixed(2)} MB`);
          return {
            profileId: item.profileId,
            profileName: item.profileName || '未命名档案',
            examCount: Number(item.examCount || 0),
            deletedAtLabel: this._formatSyncTime(deletedTime),
            _dataSize: dataSizeText,
            _deletedAt: this._formatSyncTime(deletedTime) || '未知',
            _daysLeft: daysLeft,
            _selected: false
          };
        }),
        deletedProfileSelection: []
      });
      this._setSyncStatus(
        deletedProfiles.length ? '请选择要恢复或彻底删除的档案' : '回收站是空的',
        deletedProfiles.length ? 'info' : 'success'
      );
    } catch (error) {
      this._setSyncStatus(error.message || '读取回收站失败', 'error');
      wx.showToast({ title: '读取失败', icon: 'none' });
    } finally {
      this.setData({ recycleBusy: false });
    }
  },

  closeRecycleBin() {
    this.setData({
      showRecycleBinPicker: false,
      deletedCloudProfiles: [],
      deletedProfileSelection: [],
      recycleBusy: false
    });
  },

  toggleDeletedProfileSelection(e) {
    const profileId = e.currentTarget.dataset.profileId;
    if (!profileId) return;

    const selected = new Set(this.data.deletedProfileSelection || []);
    if (selected.has(profileId)) selected.delete(profileId);
    else selected.add(profileId);

    this.setData({
      deletedProfileSelection: Array.from(selected)
    });
  },

  async restoreDeletedProfiles() {
    const selectedIds = this.data.deletedProfileSelection || [];
    if (!selectedIds.length) {
      wx.showToast({ title: '请选择要恢复的档案', icon: 'none' });
      return;
    }

    // VIP 限制：非VIP不能从回收站恢复
    const recycleCheck = vip.checkLimit('recycleBinRestore');
    if (!recycleCheck.allowed) {
      this.setData({
        showConfirmModal: true,
        confirmIcon: '👑',
        confirmIconType: 'info',
        confirmTitle: '需要 VIP 权限',
        confirmMessage: recycleCheck.reason || '升级 VIP 后可恢复已删除的档案数据。',
        confirmOkText: '获取VIP',
        confirmOkClass: 'btn-primary',
        confirmShowCancel: true,
        _confirmCallback: () => {
          this.showVipGuide();
        }
      });
      return;
    }

    try {
      this.setData({ recycleBusy: true });
      this._setSyncStatus('正在恢复档案...', 'pending');
      await cloudSync.restoreDeletedProfiles(selectedIds);
      await this.openRecycleBin();
      this._setSyncStatus('档案已从回收站恢复', 'success');
      wx.showToast({ title: '恢复成功', icon: 'success' });
    } catch (error) {
      this._setSyncStatus(error.message || '恢复失败', 'error');
      wx.showToast({ title: '恢复失败', icon: 'none' });
    } finally {
      this.setData({ recycleBusy: false });
    }
  },

  async purgeDeletedProfiles() {
    const selectedIds = this.data.deletedProfileSelection || [];
    if (!selectedIds.length) {
      wx.showToast({ title: '请选择要彻底删除的档案', icon: 'none' });
      return;
    }

    this.data._confirmCallback = async () => {
      try {
        this.setData({ recycleBusy: true });
        this._setSyncStatus('正在彻底删除...', 'pending');
        await cloudSync.purgeDeletedProfiles(selectedIds);
        await this.openRecycleBin();
        this._setSyncStatus('已彻底删除选中档案', 'success');
        wx.showToast({ title: '删除成功', icon: 'success' });
      } catch (error) {
        this._setSyncStatus(error.message || '删除失败', 'error');
        wx.showToast({ title: '删除失败', icon: 'none' });
      } finally {
        this.setData({ recycleBusy: false });
      }
    };

    this.setData({
      showConfirmModal: true,
      confirmIcon: '⚠️',
      confirmIconType: 'danger',
      confirmTitle: '彻底删除？',
      confirmMessage: '此操作不可恢复！将永久删除选中档案的所有数据。',
      confirmOkText: '彻底删除',
      confirmOkClass: 'btn-danger',
      confirmShowCancel: true
    });
  },

  // ======================== 邀请码 ========================

  onInviteCodeInput(e) {
    this.setData({ inviteCode: e.detail.value });
  },

  /**
   * 显示孤儿档案选择对话框
   */
  _showOrphanDataDialog(profileNames, examCount, userId) {
    wx.showModal({
      title: '发现本地数据',
      content: `检测到「${profileNames}」共 ${examCount} 条成绩，是否同步到当前账号？`,
      confirmText: '同步到账号',
      cancelText: '移入回收站',
      success: async (res) => {
        if (res.confirm) {
          // 认领到当前账号
          storage.claimOrphanProfiles(userId);
          wx.showToast({ title: '数据已同步到当前账号', icon: 'success' });
        } else if (res.cancel) {
          // 归档到回收站，本地清除
          wx.showLoading({ title: '归档中...' });
          try {
            const archived = await cloudSync.archiveOrphanProfiles(userId);
            wx.hideLoading();
            wx.showToast({ title: `${archived} 个档案已移入回收站`, icon: 'success' });
            this._syncAuthState();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '归档失败', icon: 'none' });
          }
        }
      }
    });
  },

  async submitInviteCode() {
    const code = (this.data.inviteCode || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入兑换码', icon: 'none' });
      return;
    }

    try {
      this.setData({ inviteCodeBusy: true, inviteCodeMessage: '', inviteCodeMessageType: '' });
      const result = await vip.redeemVipCode(code);

      if (result.success) {
        this._syncAuthState();
        this.setData({
          inviteCodeMessage: '🎉 兑换成功！',
          inviteCodeMessageType: 'success',
          inviteCode: ''
        });
        wx.showToast({ title: '兑换成功', icon: 'success' });
      } else {
        this.setData({
          inviteCodeMessage: result.reason || '兑换码无效',
          inviteCodeMessageType: 'error'
        });
      }
    } catch (err) {
      this.setData({
        inviteCodeMessage: '兑换失败，请稍后重试',
        inviteCodeMessageType: 'error'
      });
    } finally {
      this.setData({ inviteCodeBusy: false });
    }
  }
});
