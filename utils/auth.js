const { callFunction, ENV_ID } = require('./cloud');

const TOKEN_KEY = 'xueji_auth_token';
const USER_KEY = 'xueji_auth_user';
const ADMIN_ACCOUNT = 'admin';
const ADMIN_PASSWORD = 'why123456';
const ADMIN_ACCESS_TOKEN = 'xueji_admin_token_v1';

function detectAccountType(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'unknown';
  if (trimmed.toLowerCase() === ADMIN_ACCOUNT) return 'admin';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'email';
  if (/^1[3-9]\d{9}$/.test(trimmed)) return 'phone';
  return 'unknown';
}

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('请输入正确的邮箱地址');
  return value;
}

function normalizePhone(phone) {
  const value = String(phone || '').trim();
  if (!/^1[3-9]\d{9}$/.test(value)) throw new Error('请输入正确的手机号');
  return value;
}

function normalizeCode(code) {
  const value = String(code || '').trim();
  if (!/^\d{6}$/.test(value)) throw new Error('请输入 6 位验证码');
  return value;
}

function normalizePassword(password) {
  const value = String(password || '');
  if (value.length < 6) throw new Error('密码至少需要 6 位');
  return value;
}

function mapCloudUser(data) {
  if (!data) return null;
  const user = data.user || data;
  return {
    id: user.id || user._id || '',
    email: user.email || '',
    phone: user.phone || '',
    nickname: user.nickname || user.email || user.phone || '云端用户',
    avatarUrl: user.avatarUrl || '',
    isAdmin: !!user.isAdmin,
    role: user.role || '',
    vipExpireAt: user.vipExpireAt || user.vip_expire_at || null
  };
}

function buildAdminUser() {
  return {
    id: 'local-admin',
    email: '',
    phone: '',
    nickname: '管理员',
    avatarUrl: '',
    isAdmin: true,
    role: 'admin',
    accessToken: ADMIN_ACCESS_TOKEN
  };
}

function saveSession(payload) {
  if (payload && payload.user) {
    wx.setStorageSync(USER_KEY, JSON.stringify(payload.user));
    const user = payload.user;
    const vipState = (user.role === 'vip' || user.isAdmin)
      ? { isVip: true, expireAt: user.vipExpireAt || null }
      : (user.vipExpireAt && new Date(user.vipExpireAt).getTime() > Date.now())
        ? { isVip: true, expireAt: user.vipExpireAt }
        : { isVip: false, expireAt: null };
    try { wx.setStorageSync('xueji_vip_state', JSON.stringify(vipState)); } catch (e) {}
  } else {
    wx.removeStorageSync(USER_KEY);
    try { wx.removeStorageSync('xueji_vip_state'); } catch (e) {}
  }

  if (payload && payload.token) {
    wx.setStorageSync(TOKEN_KEY, payload.token);
  } else {
    wx.removeStorageSync(TOKEN_KEY);
  }
}

function getCurrentUser() {
  const raw = wx.getStorageSync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    wx.removeStorageSync(USER_KEY);
    return null;
  }
}

function getStoredToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

async function signOut() {
  saveSession(null);
  try { wx.removeStorageSync('xueji_vip_state'); } catch (e) {}
}

async function sendEmailCode(email) {
  const result = await callFunction('sendEmailCode', { email: normalizeEmail(email) });
  if (result.code !== 0 && result.code !== 200) throw new Error(result.message || '验证码发送失败');
  return result;
}

/**
 * 发送短信验证码 —— 调用线上 sendSmsCode 云函数
 * 云函数会生成验证码存入 sms_codes 集合，并通过腾讯云短信 API 发送
 */
async function sendSmsCode(phone, scene) {
  const normalizedPhone = normalizePhone(phone);
  const result = await callFunction('sendSmsCode', {
    phone: normalizedPhone,
    scene: scene || 'login'
  });
  if (result.code !== 0) throw new Error(result.message || '验证码发送失败');
  return result;
}

/**
 * 密码登录
 * - admin: 本地校验
 * - phone: 调用 phoneLogin 云函数（verified 模式）
 * - email: 调用 passwordLogin 云函数
 */
async function passwordLogin(account, password) {
  const type = detectAccountType(account);
  const normalizedPassword = normalizePassword(password);

  if (type === 'admin') {
    if (normalizedPassword !== ADMIN_PASSWORD) throw new Error('账号或密码错误');
    const user = buildAdminUser();
    saveSession({ token: user.accessToken, user });
    return { token: user.accessToken, user };
  }

  if (type === 'phone') {
    // 手机号+密码登录：暂时不支持，提示用户使用验证码登录
    throw new Error('手机号暂不支持密码登录，请使用验证码登录');
  }

  if (type !== 'email') {
    throw new Error('请输入邮箱、手机号或管理员账号');
  }

  const result = await callFunction('passwordLogin', {
    email: normalizeEmail(account),
    password: normalizedPassword
  });

  if (result.code !== 0) {
    const error = new Error(result.message || '登录失败');
    error.code = result.code;
    throw error;
  }

  const user = mapCloudUser(result.data);
  saveSession({ token: result.data && result.data.token, user });
  return { token: result.data && result.data.token, user };
}

/**
 * 验证码登录
 * - phone: 调用 phoneLogin 云函数
 * - email: 调用 emailLogin 云函数
 */
async function codeLogin(account, code) {
  const type = detectAccountType(account);
  const normalizedCode = normalizeCode(code);

  if (type === 'phone') {
    const normalizedPhone = normalizePhone(account);
    const result = await callFunction('phoneLogin', {
      phone: normalizedPhone,
      code: normalizedCode
    });
    if (result.code !== 0) throw new Error(result.message || '登录失败');
    const user = mapCloudUser(result.data);
    saveSession({ token: result.data && result.data.token, user });
    return { token: result.data && result.data.token, user };
  }

  if (type !== 'email') {
    throw new Error('验证码登录仅支持邮箱或手机号');
  }

  const result = await callFunction('emailLogin', {
    email: normalizeEmail(account),
    code: normalizedCode
  });

  if (result.code !== 0) throw new Error(result.message || '登录失败');

  const user = mapCloudUser(result.data);
  saveSession({ token: result.data && result.data.token, user });
  return { token: result.data && result.data.token, user };
}

/**
 * 注册
 * - phone: 调用 phoneRegister 云函数
 * - email: 调用 emailRegister 云函数
 */
async function register(account, code, password) {
  const type = detectAccountType(account);
  const normalizedCode = normalizeCode(code);
  const normalizedPassword = normalizePassword(password);

  if (type === 'phone') {
    const normalizedPhone = normalizePhone(account);
    const result = await callFunction('phoneRegister', {
      phone: normalizedPhone,
      code: normalizedCode,
      password: normalizedPassword
    });
    if (result.code !== 0) throw new Error(result.message || '注册失败');
    const user = mapCloudUser(result.data);
    saveSession({ token: result.data && result.data.token, user });
    return { token: result.data && result.data.token, user };
  }

  if (type !== 'email') {
    throw new Error('注册仅支持邮箱或手机号');
  }

  const result = await callFunction('emailRegister', {
    email: normalizeEmail(account),
    code: normalizedCode,
    password: normalizedPassword
  });

  if (result.code !== 0) throw new Error(result.message || '注册失败');

  const user = mapCloudUser(result.data);
  saveSession({ token: result.data && result.data.token, user });
  return { token: result.data && result.data.token, user };
}

/**
 * 重置密码
 * - phone: 调用 phoneResetPassword 云函数
 * - email: 调用 resetPassword 云函数
 */
async function resetPassword(account, code, newPassword) {
  const type = detectAccountType(account);
  const normalizedCode = normalizeCode(code);
  const normalizedPassword = normalizePassword(newPassword);

  if (type === 'phone') {
    const normalizedPhone = normalizePhone(account);
    const result = await callFunction('phoneResetPassword', {
      phone: normalizedPhone,
      code: normalizedCode,
      newPassword: normalizedPassword
    });
    if (result.code !== 0) throw new Error(result.message || '重置失败');
    const user = mapCloudUser(result.data);
    saveSession({ token: result.data && result.data.token, user });
    return { token: result.data && result.data.token, user };
  }

  if (type !== 'email') {
    throw new Error('请输入正确的邮箱地址或手机号');
  }

  const result = await callFunction('resetPassword', {
    email: normalizeEmail(account),
    code: normalizedCode,
    newPassword: normalizedPassword
  });

  if (result.code !== 0) throw new Error(result.message || '重置失败');

  const user = mapCloudUser(result.data);
  saveSession({ token: result.data && result.data.token, user });
  return { token: result.data && result.data.token, user };
}

async function updateNickname(userId, nickname) {
  const value = String(nickname || '').trim();
  if (!value) throw new Error('请输入昵称');

  const result = await callFunction('updateNickname', {
    userId,
    nickname: value
  });
  if (result.code !== 0) throw new Error(result.message || '昵称更新失败');

  const user = getCurrentUser();
  if (user && user.id === userId) {
    user.nickname = value;
    saveSession({ token: getStoredToken(), user });
  }
  return result.data;
}

/**
 * 从云端刷新当前用户信息（昵称等）
 */
async function refreshUser() {
  const token = getStoredToken();
  if (!token) return null;

  try {
    const result = await callFunction('verifyToken', { token });
    if (!result || result.code !== 0 || !result.data) {
      signOut();
      return null;
    }

    const cloudData = result.data;
    const user = getCurrentUser();
    if (!user) return null;

    user.nickname = cloudData.nickname || user.nickname;
    user.email = cloudData.email || user.email;
    user.phone = cloudData.phone || user.phone;
    user.avatarUrl = cloudData.avatarUrl || user.avatarUrl;
    if (cloudData.role) user.role = cloudData.role;
    if (cloudData.vipExpireAt || cloudData.vip_expire_at) {
      user.vipExpireAt = cloudData.vipExpireAt || cloudData.vip_expire_at;
    }
    saveSession({ token, user });
    return user;
  } catch (error) {
    console.warn('[auth] refreshUser failed:', error);
    return getCurrentUser();
  }
}

/**
 * 微信一键登录：仅通过 openid 标识用户
 */
async function wxLogin() {
  const result = await callFunction('wxLogin', {});

  if (result.code !== 0) {
    throw new Error(result.message || '微信登录失败');
  }

  const user = mapCloudUser(result.data);
  saveSession({ token: result.data && result.data.token, user });
  return { token: result.data && result.data.token, user };
}

/**
 * 绑定手机号或邮箱
 */
async function bindAccount(type, value, code) {
  const token = getStoredToken();
  if (!token) throw new Error('请先登录');

  const normalizedValue = type === 'phone' ? normalizePhone(value) : normalizeEmail(value);
  const normalizedCode = normalizeCode(code);

  const result = await callFunction('bindAccount', {
    type,
    value: normalizedValue,
    code: normalizedCode,
    token
  });

  if (result.code !== 0) {
    throw new Error(result.message || '绑定失败');
  }

  const currentUser = getCurrentUser();
  if (currentUser && result.data && result.data.user) {
    const updatedUser = mapCloudUser(result.data);
    saveSession({ token: result.data.token || token, user: updatedUser });
    return { token: result.data.token || token, user: updatedUser };
  }

  if (currentUser) {
    if (type === 'phone') currentUser.phone = normalizedValue;
    if (type === 'email') currentUser.email = normalizedValue;
    saveSession({ token, user: currentUser });
  }

  return { token, user: currentUser };
}

module.exports = {
  detectAccountType,
  getCurrentUser,
  getStoredToken,
  signOut,
  sendEmailCode,
  sendSmsCode,
  passwordLogin,
  codeLogin,
  register,
  resetPassword,
  updateNickname,
  refreshUser,
  wxLogin,
  bindAccount
};
