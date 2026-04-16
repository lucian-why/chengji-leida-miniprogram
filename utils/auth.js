const { callFunction, ENV_ID } = require('./cloud');

const TOKEN_KEY = 'xueji_auth_token';
const USER_KEY = 'xueji_auth_user';
const ADMIN_ACCOUNT = 'admin';
const ADMIN_PASSWORD = 'why123456';
const ADMIN_ACCESS_TOKEN = 'xueji_admin_token_v1';

let sdkApp = null;
let sdkAuth = null;
const resetVerificationMap = Object.create(null);

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
    // 同步 VIP 缓存，防止切换账号后旧 VIP 状态残留
    const user = payload.user;
    const vipState = (user.role === 'vip' || user.isAdmin)
      ? { isVip: true, expireAt: user.vipExpireAt || null }
      : (user.vipExpireAt && new Date(user.vipExpireAt).getTime() > Date.now())
        ? { isVip: true, expireAt: user.vipExpireAt }
        : { isVip: false, expireAt: null };
    try { wx.setStorageSync('xueji_vip_state', JSON.stringify(vipState)); } catch (e) {}
  } else {
    wx.removeStorageSync(USER_KEY);
    // 登出时清除 VIP 缓存
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

async function getPhoneAuth() {
  if (sdkAuth) return sdkAuth;

  let cloudbase = null;
  try {
    cloudbase = require('@cloudbase/js-sdk');
  } catch (error) {
    throw new Error('手机号验证码能力依赖 CloudBase JS SDK，请先在微信开发者工具里构建 npm。');
  }

  const sdk = cloudbase.default || cloudbase;
  sdkApp = sdk.init({
    env: ENV_ID,
    persistence: 'local'
  });
  sdkAuth = sdkApp.auth({ persistence: 'local' });
  return sdkAuth;
}

async function buildPhoneSession(auth, fallbackPhone, result) {
  let profile = null;
  try {
    profile = await auth.getUserInfo();
  } catch (error) {
    profile = null;
  }

  const source = (profile && (profile.userInfo || profile))
    || (result && (result.user || (result.data && result.data.user)))
    || {};

  const token = typeof auth.getAccessToken === 'function'
    ? (auth.getAccessToken() || '')
    : '';

  const user = {
    id: source.uid || source.id || source.sub || '',
    email: source.email || '',
    phone: source.phone_number || fallbackPhone || '',
    nickname: source.name || source.nickname || source.username || fallbackPhone || '手机用户',
    avatarUrl: source.picture || source.avatarUrl || '',
    isAdmin: false,
    role: ''
  };

  saveSession({ token, user });
  return { token, user };
}

async function signOut() {
  saveSession(null);
  Object.keys(resetVerificationMap).forEach((key) => delete resetVerificationMap[key]);
  // 清除 VIP 缓存，防止切换账号后旧 VIP 状态残留
  try { wx.removeStorageSync('xueji_vip_state'); } catch (e) {}
  if (sdkAuth && typeof sdkAuth.signOut === 'function') {
    try {
      await sdkAuth.signOut();
    } catch (error) {
      // ignore
    }
  }
}

async function sendEmailCode(email) {
  const result = await callFunction('sendEmailCode', { email: normalizeEmail(email) });
  if (result.code !== 0) throw new Error(result.message || '验证码发送失败');
  return result;
}

async function sendSmsCode(phone, scene) {
  const normalizedPhone = normalizePhone(phone);
  const auth = await getPhoneAuth();
  const currentScene = scene || 'login';

  if (currentScene === 'resetpwd') {
    const verificationInfo = await auth.getVerification({
      phone_number: `+86 ${normalizedPhone}`
    });
    resetVerificationMap[normalizedPhone] = verificationInfo;
    return verificationInfo;
  }

  const result = await auth.sendPhoneCode(normalizedPhone);
  if (result && result.error) {
    throw new Error(result.error.message || result.error.msg || '验证码发送失败');
  }
  return result;
}

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
    const auth = await getPhoneAuth();
    const result = await auth.signInWithPhoneCodeOrPassword({
      phoneNumber: normalizePhone(account),
      password: normalizedPassword
    });
    if (result && result.error) {
      throw new Error(result.error.message || result.error.msg || '登录失败');
    }
    return buildPhoneSession(auth, normalizePhone(account), result);
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
    const auth = await getPhoneAuth();
    const result = await auth.signInWithPhoneCodeOrPassword({
      phoneNumber: normalizedPhone,
      phoneCode: normalizedCode
    });
    if (result && result.error) {
      throw new Error(result.error.message || result.error.msg || '登录失败');
    }
    return buildPhoneSession(auth, normalizedPhone, result);
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
    const auth = await getPhoneAuth();
    const result = await auth.signUpWithPhoneCode(normalizedPhone, normalizedCode, normalizedPassword);
    if (result && result.error) {
      throw new Error(result.error.message || result.error.msg || '注册失败');
    }
    return buildPhoneSession(auth, normalizedPhone, result);
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
    const auth = await getPhoneAuth();
    const verificationInfo = resetVerificationMap[normalizedPhone];
    if (!verificationInfo || !verificationInfo.verification_id) {
      throw new Error('请先发送验证码');
    }

    const verificationResult = await auth.verify({
      verification_id: verificationInfo.verification_id,
      verification_code: normalizedCode
    });

    const verificationToken = verificationResult && (verificationResult.verificationToken || verificationResult.verification_token);
    if (!verificationToken) {
      throw new Error('验证码校验失败，请重新发送');
    }

    const result = await auth.resetPassword({
      phone_number: `+86 ${normalizedPhone}`,
      password: normalizedPassword,
      verification_token: verificationToken
    });

    if (result && result.error) {
      throw new Error(result.error.message || result.error.msg || '重置失败');
    }

    delete resetVerificationMap[normalizedPhone];

    const loginResult = await auth.signInWithPhoneCodeOrPassword({
      phoneNumber: normalizedPhone,
      password: normalizedPassword
    });

    if (loginResult && loginResult.error) {
      throw new Error(loginResult.error.message || loginResult.error.msg || '重置后自动登录失败');
    }

    return buildPhoneSession(auth, normalizedPhone, loginResult);
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
 * 在页面加载时调用，确保多端昵称同步
 */
async function refreshUser() {
  const token = getStoredToken();
  if (!token) return null;

  try {
    const result = await callFunction('verifyToken', { token });
    if (!result || result.code !== 0 || !result.data) {
      // token 无效，清除本地登录态
      signOut();
      return null;
    }

    const cloudData = result.data;
    const user = getCurrentUser();
    if (!user) return null;

    // 更新本地缓存的用户信息（包括 VIP 状态）
    user.nickname = cloudData.nickname || user.nickname;
    user.email = cloudData.email || user.email;
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
 * 微信一键登录：获取 openid + 手机号完成登录/注册
 * @param {string} phoneCode - getPhoneNumber 按钮回调的 code
 */
async function wxLogin(phoneCode) {
  const result = await callFunction('wxLogin', { phoneCode: phoneCode || '' });

  if (result.code !== 0) {
    throw new Error(result.message || '微信登录失败');
  }

  const user = mapCloudUser(result.data);
  saveSession({ token: result.data && result.data.token, user });
  return { token: result.data && result.data.token, user };
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
  wxLogin
};
