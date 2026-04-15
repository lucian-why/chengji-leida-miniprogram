const storage = require('./utils/storage');

const APP_ID = 'wx07532e8f45b25fe6';
const ENV_ID = 'chengjiguanjia-1g1twvrkd736c880';

App({
  globalData: {
    version: '2.0.0'
  },
  onLaunch() {
    // 初始化云开发（小程序原生 AI 能力依赖此初始化）
    if (wx.cloud) {
      wx.cloud.init({
        env: ENV_ID,
        appid: APP_ID,
        traceUser: true
      });
    }
    storage.migrateProfilesIfNeeded();
  }
});
