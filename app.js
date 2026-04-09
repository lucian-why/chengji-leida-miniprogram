const storage = require('./utils/storage');

App({
  globalData: {
    version: '2.0.0'
  },
  onLaunch() {
    // 初始化云开发（小程序原生 AI 能力依赖此初始化）
    if (wx.cloud) {
      wx.cloud.init({
        env: 'chengjiguanjia-1g1twvrkd736c880',
        traceUser: true
      });
    }
    storage.migrateProfilesIfNeeded();
  }
});
