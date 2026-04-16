/**
 * 页面 data 默认值定义
 * 按功能模块分组，index.js 通过 Object spread 合并
 */

module.exports._global = {
  profiles: [],
  activeProfileIndex: 0,
  profileNames: [],
  currentTab: 'exam',
  exams: [],
  currentExamId: '',
  currentExam: null,
  showDetailPanel: false,
  isEditingTotalScore: false,
  editingTotalScore: '',
  hasDemoData: false,
  _slideDirection: '',
  showScoreView: false,
  _panelSlidingOut: false
};

module.exports.exam = {
  editExamId: '',
  showExamModal: false,
  examForm: {
    name: '',
    startDate: '',
    endDate: '',
    notes: '',
    totalClassRank: '',
    totalGradeRank: '',
    classTotal: '',
    gradeTotal: ''
  }
};

module.exports.score = {
  editSubjectIndex: null,
  showScoreModal: false,
  scoreForm: {
    name: '',
    score: '',
    fullScore: '100',
    classRank: '',
    gradeRank: '',
    notes: ''
  }
};

module.exports.batch = {
  showBatchModal: false,
  batchList: [],
  newBatchSubject: ''
};

module.exports.chart = {
  analysisMode: 'score',
  selectedChartSubject: '',
  rankType: 'class',
  subjectNames: [],
  trendEmpty: false,
  radarExams: [],
  compareExams: [],
  selectedCompareCount: 0,
  radarEmpty: false,
  radarEmptyText: '选择考试后查看各科得分率分析',
  showChartZoom: false,
  chartZoomType: '',
  chartZoomTitle: '',
  zoomSelectedSubject: '',
  zoomRankType: 'class'
};

module.exports.profile = {
  showProfilePicker: false,
  showAddProfile: false,
  showRenameModal: false,
  newProfileName: '',
  renameValue: '',
  _renameProfileIndex: null
};

module.exports.modal = {
  showConfirmModal: false,
  confirmIcon: '',
  confirmIconType: '',
  confirmTitle: '',
  confirmMessage: '',
  confirmOkText: '确定',
  confirmOkClass: 'btn-primary',
  confirmShowCancel: true,
  _confirmCallback: null,
  showDeleteSubjectModal: false,
  deleteSubjectList: [],
  deleteSubjectSelected: -1
};

module.exports.report = {
  showReportModal: false,
  reportType: '',
  reportLoading: false,
  reportImage: '',
  reportCanvasHeight: 0
};

module.exports.auth = {
  authUser: null,
  isLoggedIn: false,
  showAuthModal: false,
  showNicknameModal: false,
  authMode: 'login',
  authTitle: '账号登录',
  authSubmitText: '登录',
  authDisplayName: '未登录',
  authDisplayDesc: '先登录账号，后续小程序会继续接入云端备份与恢复。',
  authDisplayHint: '',
  authSendCodeText: '发送验证码',
  authShowPasswordSection: true,
  authShowCodeSection: false,
  authShowResetSection: false,
  authShowLoginLink: false,
  authShowSmsLink: true,
  authShowRegisterLink: true,
  authShowResetLink: true,
  authAccount: '',
  authCode: '',
  authPassword: '',
  authConfirmPassword: '',
  authNewPassword: '',
  authStatusMessage: '',
  authStatusType: '',
  authSendingCode: false,
  authCountdown: 0,
  authSubmitting: false,
  syncBusy: false,
  syncStatusMessage: '',
  syncStatusType: '',
  syncLastAt: '',
  showCloudRestorePicker: false,
  cloudRestoreProfiles: [],
  showRecycleBinPicker: false,
  deletedCloudProfiles: [],
  deletedProfileSelection: [],
  recycleBusy: false,
  nicknameValue: '',
  nicknameSaving: false,
  authPasswordVisible: false,
  authNewPasswordVisible: false,
  authConfirmPasswordVisible: false
};
