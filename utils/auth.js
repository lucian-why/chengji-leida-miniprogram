const { callFunction, ENV_ID } = require('./cloud');

const TOKEN_KEY = 'xueji_auth_token';
const REFRESH_TOKEN_KEY = 'xueji_auth_refresh_token';
const USER_KEY = 'xueji_auth_user';
const DEVICE_KEY = 'xueji_auth_device_id';
const VERIFICATION_PREFIX = 'xueji_auth_verification_';
const AUTH_API_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`;
const ADMIN_ACCOUNT = 'admin';

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

function toCloudbasePhone(phone) {
  return `+86 ${normalizePhone(phone)}`;
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

function mapOfficialUser(profile, tokenData) {
  const user = profile || {};
  const phone = String(user.phone_number || user.phone || '').replace(/^\+86\s*/, '');
  const groups = Array.isArray(user.groups) ? user.groups.map(g => g.id || g).filter(Boolean) : [];
  const role = groups.includes('admin') ? 'admin' : (groups.includes('vip') ? 'vip' : '');
  return {
    id: user.sub || user.user_id || tokenData?.sub || '',
    email: user.email || '',
    phone,
    nickname: user.name || user.username || user.email || phone || '云端用户',
    avatarUrl: user.picture || user.avatar_url || '',
    isAdmin: groups.includes('admin'),
    role,
    vipExpireAt: user.vipExpireAt || user.vip_expire_at || user.meta?.vipExpireAt || null
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

  if (payload && payload.refreshToken) {
    wx.setStorageSync(REFRESH_TOKEN_KEY, payload.refreshToken);
  } else if (!payload) {
    wx.removeStorageSync(REFRESH_TOKEN_KEY);
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

function getDeviceId() {
  let deviceId = wx.getStorageSync(DEVICE_KEY);
  if (!deviceId) {
    deviceId = `mp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    wx.setStorageSync(DEVICE_KEY, deviceId);
  }
  return deviceId;
}

function buildAuthUrl(path) {
  return `${AUTH_API_BASE}${path}`;
}

function normalizeAuthApiError(data, fallbackMessage) {
  const message = data?.error_description || data?.message || data?.error || fallbackMessage;
  if (data?.error === 'captcha_required') {
    return new Error('当前操作需要图片验证码，请稍后重试或换用其他登录方式');
  }
  if (data?.error === 'rate_limit_exceeded') {
    return new Error('验证码发送过于频繁，请稍后再试');
  }
  if (data?.error === 'user_not_found') {
    return new Error('该手机号尚未注册，请先注册账号');
  }
  if (data?.error === 'invalid_verification_code') {
    return new Error('验证码错误，请重新输入');
  }
  return new Error(message || fallbackMessage);
}

function authApiRequest(path, options) {
  options = options || {};
  const method = options.method || 'POST';
  const headers = {
    'content-type': 'application/json',
    'x-device-id': getDeviceId()
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.captchaToken) {
    headers['x-captcha-token'] = options.captchaToken;
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: buildAuthUrl(path),
      method,
      header: headers,
      data: options.data || {},
      timeout: options.timeout || 20000,
      success(res) {
        const data = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && !data.error) {
          resolve(data);
          return;
        }
        reject(normalizeAuthApiError(data, options.fallbackMessage || '认证服务请求失败'));
      },
      fail(err) {
        reject(new Error(err?.errMsg || '认证服务请求失败'));
      }
    });
  });
}

function getVerificationStorageKey(account, scene) {
  return `${VERIFICATION_PREFIX}${scene || 'login'}_${String(account || '').trim().toLowerCase()}`;
}

function saveVerificationState(account, scene, data) {
  wx.setStorageSync(getVerificationStorageKey(account, scene), JSON.stringify({
    verificationId: data.verification_id,
    isUser: !!data.is_user,
    expiresAt: Date.now() + Number(data.expires_in || 600) * 1000
  }));
}

function getVerificationState(account, scene) {
  const key = getVerificationStorageKey(account, scene);
  const raw = wx.getStorageSync(key);
  if (!raw) throw new Error('请先获取验证码');
  let state;
  try {
    state = JSON.parse(raw);
  } catch (error) {
    wx.removeStorageSync(key);
    throw new Error('验证码状态已失效，请重新获取');
  }
  if (!state.verificationId || Date.now() > state.expiresAt) {
    wx.removeStorageSync(key);
    throw new Error('验证码已过期，请重新获取');
  }
  return { ...state, key };
}

function clearVerificationState(account, scene) {
  wx.removeStorageSync(getVerificationStorageKey(account, scene));
}

function getVerificationPayload(account, scene) {
  const state = getVerificationState(account, scene);
  return {
    verificationId: state.verificationId,
    deviceId: getDeviceId()
  };
}

function getOfficialTarget(scene) {
  return (scene === 'sms_login' || scene === 'resetpwd') ? 'USER' : 'ANY';
}

async function sendOfficialPhoneCode(phone, scene) {
  const normalizedPhone = normalizePhone(phone);
  const result = await authApiRequest('/auth/v1/verification', {
    data: {
      phone_number: toCloudbasePhone(normalizedPhone),
      target: getOfficialTarget(scene)
    },
    fallbackMessage: '验证码发送失败'
  });
  if (!result.verification_id) throw new Error('验证码发送失败，请稍后重试');
  saveVerificationState(normalizedPhone, scene, result);
  return result;
}

async function verifyOfficialCode(account, code, scene) {
  const normalizedPhone = normalizePhone(account);
  const state = getVerificationState(normalizedPhone, scene);
  const result = await authApiRequest('/auth/v1/verification/verify', {
    data: {
      verification_id: state.verificationId,
      verification_code: normalizeCode(code)
    },
    fallbackMessage: '验证码校验失败'
  });
  if (!result.verification_token) throw new Error('验证码校验失败，请重新输入');
  clearVerificationState(normalizedPhone, scene);
  return result.verification_token;
}

async function fetchOfficialProfile(token) {
  return authApiRequest('/auth/v1/user/me', {
    method: 'GET',
    token,
    fallbackMessage: '读取用户信息失败'
  });
}

async function saveOfficialSession(tokenData) {
  const token = tokenData?.access_token || '';
  if (!token) throw new Error('登录失败：未返回访问令牌');
  const profile = await fetchOfficialProfile(token).catch(() => null);
  try {
    const result = await callFunction('syncOfficialUser', {
      accessToken: token,
      refreshToken: tokenData.refresh_token || ''
    });
    if (result && result.code === 0 && result.data) {
      const user = mapCloudUser(result.data);
      saveSession({ token: result.data.token || token, refreshToken: tokenData.refresh_token || '', user });
      return { token: result.data.token || token, user };
    }
  } catch (error) {
    console.warn('[auth] syncOfficialUser fallback:', error.message || error);
  }

  const user = mapOfficialUser(profile, tokenData);
  saveSession({
    token,
    refreshToken: tokenData.refresh_token || '',
    user
  });
  return { token, user };
}

async function officialSignInWithVerification(verificationToken) {
  const result = await authApiRequest('/auth/v1/signin', {
    data: { verification_token: verificationToken },
    fallbackMessage: '登录失败'
  });
  return saveOfficialSession(result);
}

async function officialSignUpWithPhone(phone, verificationToken, password) {
  const result = await authApiRequest('/auth/v1/signup', {
    data: {
      phone_number: toCloudbasePhone(phone),
      verification_token: verificationToken,
      password
    },
    fallbackMessage: '注册失败'
  });
  return saveOfficialSession(result);
}

async function sendEmailCode(email) {
  const result = await callFunction('sendEmailCode', {
    email: normalizeEmail(email)
  });
  if (result.code !== 0) throw new Error(result.message || '验证码发送失败');
  return result;
}

/**
 * 发送短信验证码：使用 CloudBase 身份认证官方默认短信渠道
 */
async function sendSmsCode(phone, scene) {
  return sendOfficialPhoneCode(phone, scene || 'sms_login');
}

/**
 * 密码登录
 * - admin: 调用 adminLogin 云函数
 * - phone: 暂不支持密码登录
 * - email: 调用 passwordLogin 云函数
 */
async function passwordLogin(account, password) {
  const type = detectAccountType(account);
  const normalizedPassword = normalizePassword(password);

  if (type === 'admin') {
    const result = await callFunction('adminLogin', { password: normalizedPassword });
    if (result.code !== 0) throw new Error(result.message || '账号或密码错误');
    const user = mapCloudUser(result.data);
    saveSession({ token: result.data && result.data.token, user });
    return { token: result.data && result.data.token, user };
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

async function codeLogin(account, code) {
  const type = detectAccountType(account);
  const normalizedCode = normalizeCode(code);

  if (type === 'phone') {
    const normalizedPhone = normalizePhone(account);
    const verificationToken = await verifyOfficialCode(normalizedPhone, normalizedCode, 'sms_login');
    return officialSignInWithVerification(verificationToken);
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

async function register(account, code, password) {
  const type = detectAccountType(account);
  const normalizedCode = normalizeCode(code);
  const normalizedPassword = normalizePassword(password);

  if (type === 'phone') {
    const normalizedPhone = normalizePhone(account);
    const verificationToken = await verifyOfficialCode(normalizedPhone, normalizedCode, 'register');
    return officialSignUpWithPhone(normalizedPhone, verificationToken, normalizedPassword);
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

async function resetPassword(account, code, newPassword) {
  const type = detectAccountType(account);
  const normalizedCode = normalizeCode(code);
  const normalizedPassword = normalizePassword(newPassword);

  if (type === 'phone') {
    const normalizedPhone = normalizePhone(account);
    const verificationToken = await verifyOfficialCode(normalizedPhone, normalizedCode, 'resetpwd');
    const session = await officialSignInWithVerification(verificationToken);
    const sudo = await authApiRequest('/auth/v1/user/sudo', {
      token: session.token,
      data: { verification_token: verificationToken },
      fallbackMessage: '重置密码验证失败'
    });
    await authApiRequest(`/auth/v1/user/password?sudo_token=${encodeURIComponent(sudo.sudo_token || '')}`, {
      method: 'PATCH',
      token: session.token,
      data: {
        new_password: normalizedPassword,
        confirm_password: normalizedPassword
      },
      fallbackMessage: '重置密码失败'
    });
    return session;
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

/*
 * 从云端刷新当前用户信息（昵称等）
 */
async function refreshUser() {
  const token = getStoredToken();
  if (!token) return null;

  try {
    const result = await callFunction('verifyToken', { token });
    if (!result || result.code !== 0 || !result.data) {
      try {
        const officialProfile = await fetchOfficialProfile(token);
        const user = mapOfficialUser(officialProfile, { access_token: token });
        saveSession({ token, refreshToken: wx.getStorageSync(REFRESH_TOKEN_KEY) || '', user });
        return user;
      } catch (officialError) {
        signOut();
        return null;
      }
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

  if (type === 'phone') {
    const verification = getVerificationPayload(normalizedValue, 'bind');
    const result = await callFunction('bindAccount', {
      type,
      value: normalizedValue,
      code: normalizedCode,
      token,
      verificationId: verification.verificationId,
      deviceId: verification.deviceId
    });

    if (result.code !== 0) {
      throw new Error(result.message || '绑定失败');
    }

    clearVerificationState(normalizedValue, 'bind');
    const updatedUser = mapCloudUser(result.data);
    saveSession({ token: result.data.token || token, user: updatedUser });
    return { token: result.data.token || token, user: updatedUser };
  }

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
