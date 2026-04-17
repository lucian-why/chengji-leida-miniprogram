const app = getApp();
const auth = require('../../utils/auth.js');

Page({
  data: {
    uuid: '',
    loading: false
  },

  onLoad(options) {
    if (options.uuid) {
      this.setData({ uuid: options.uuid });
    } else {
      wx.showToast({
        title: '无效的登录码',
        icon: 'error'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  async confirmLogin() {
    if (!this.data.uuid) return;
    
    // Ensure user is logged in locally
    const userInfo = auth.getUserInfo();
    if (!userInfo) {
      wx.showToast({
        title: '请先在小程序中登录',
        icon: 'none'
      });
      return;
    }

    this.setData({ loading: true });

    try {
      const db = wx.cloud.database();
      // Use the current user's uid/openid from auth state
      const userId = userInfo.uid || userInfo.openid || 'unknown_user';
      const token = wx.getStorageSync('xueji_token') || wx.getStorageSync('token') || '';
      
      // Update the web_login_sessions record with this user's ID to confirm login
      await db.collection('web_login_sessions').where({
        uuid: this.data.uuid
      }).update({
        data: {
          status: 'confirmed',
          userId: userId,
          user: userInfo,
          token: token,
          confirmTime: db.serverDate()
        }
      });

      wx.showToast({
        title: '授权成功',
        icon: 'success'
      });

      setTimeout(() => {
        wx.navigateBack();
      }, 1500);

    } catch (err) {
      console.error('[WebLogin] confirm login error:', err);
      // It's possible the record doesn't exist yet if we didn't insert it from Web,
      // but usually the Web creates it with status: 'pending'.
      // If we don't have update permission, we can do add/set, but let's assume Web creates it.
      
      // Fallback: If Web hasn't created it or update failed due to permissions, 
      // we can try to add the record instead.
      try {
        const db = wx.cloud.database();
        const userId = userInfo.uid || userInfo.openid || 'unknown_user';
        const token = wx.getStorageSync('xueji_token') || wx.getStorageSync('token') || '';
        
        await db.collection('web_login_sessions').add({
          data: {
            uuid: this.data.uuid,
            status: 'confirmed',
            userId: userId,
            user: userInfo,
            token: token,
            confirmTime: db.serverDate(),
            createTime: db.serverDate()
          }
        });
        
        wx.showToast({
          title: '授权成功',
          icon: 'success'
        });
        setTimeout(() => { wx.navigateBack(); }, 1500);
      } catch (addErr) {
        console.error('[WebLogin] fallback add error:', addErr);
        wx.showToast({
          title: '授权失败',
          icon: 'error'
        });
      }
    } finally {
      this.setData({ loading: false });
    }
  },

  cancelLogin() {
    wx.navigateBack();
  }
});
