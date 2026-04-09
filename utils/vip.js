/**
 * 成绩雷达 - VIP 权限模块
 *
 * 管理用户 VIP 状态和各项功能的使用限制。
 *
 * 限制规则（非VIP）：
 *   - AI 分析：每天 2 次
 *   - 档案数量：每账户最多 2 个
 *   - 云同步回收站：可查看，不能恢复数据（数据保留30天）
 *
 * 数据存储在 wx 本地存储中，key 前缀为 'xueji_vip_'。
 * VIP 状态可从 auth 用户对象的 role / vipExpireAt 字段获取。
 */

// ==================== 存储键 ====================

const auth = require('./auth');
const { callFunction } = require('./cloud');

const VIP_STATE_KEY = 'xueji_vip_state';
const QUOTA_PREFIX = 'xueji_vip_quota_';

// ==================== 限制配置 ====================

const LIMITS = {
  aiAnalysisDaily: 2,        // AI 分析每天次数
  maxProfiles: 2,             // 最大档案数量
  recycleBinRestore: false,    // 非VIP能否恢复回收站数据
};

// ==================== 内部工具 ====================

function _today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _readJSON(key, fallback) {
  try {
    const raw = wx.getStorageSync(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function _writeJSON(key, value) {
  wx.setStorageSync(key, JSON.stringify(value));
}

/**
 * 获取或初始化用量记录对象
 * 按日期隔离，跨天自动重置
 */
function _getQuotaRecord(type) {
  const key = QUOTA_PREFIX + type;
  const record = _readJSON(key, { date: '', count: 0 });

  if (record.date !== _today()) {
    // 新的一天，重置计数
    const reset = { date: _today(), count: 0 };
    _writeJSON(key, reset);
    return reset;
  }

  return record;
}

function _saveQuotaRecord(type, record) {
  const key = QUOTA_PREFIX + type;
  _writeJSON(key, record);
}

/**
 * 读取 VIP 状态缓存
 */
function _getVipState() {
  return _readJSON(VIP_STATE_KEY, { isVip: false, expireAt: null });
}

function _saveVipState(state) {
  _writeJSON(VIP_STATE_KEY, state);
}

// ==================== 公开 API ====================

/**
 * 判断当前用户是否为 VIP
 *
 * @param {Object} [user] - 可选的用户对象（来自 auth.getCurrentUser()）
 * @returns {boolean}
 */
function isVip(user) {
  // 优先使用传入的用户信息
  if (user) {
    // 已有 VIP 标记且未过期
    if (user.role === 'vip' || user.isAdmin) return true;
    if (user.vipExpireAt && new Date(user.vipExpireAt).getTime() > Date.now()) return true;
  }

  // 回退到本地缓存
  const state = _getVipState();
  if (state.isVip) {
    if (state.expireAt && new Date(state.expireAt).getTime() > Date.now()) {
      return true;
    }
    // 过期了，清除缓存状态
    if (state.expireAt) {
      _saveVipState({ isVip: false, expireAt: null });
    }
  }

  return false;
}

/**
 * 设置 VIP 状态（通常由支付成功回调调用）
 *
 * @param {Object} options
 * @param {boolean} options.isVip - 是否VIP
 * @param {string|null} [options.expireAt] - 到期时间 ISO 字符串
 */
function setVipStatus({ isVip, expireAt }) {
  _saveVipState({ isVip: !!isVip, expireAt: expireAt || null });
}

/**
 * 检查某项功能是否可用，并返回检查结果
 *
 * @param {string} type - 功能类型: 'aiAnalysis' | 'profileCount' | 'recycleBinRestore'
 * @param {Object} [currentUsage] - 当前已用量（用于 profileCount 这类需要外部传入的场景）
 * @returns {{ allowed: boolean, reason?: string, used?: number, limit?: number }}
 */
function checkLimit(type, currentUsage) {
  // VIP 用户不受限制（除了档案数硬上限）
  const user = typeof require === 'function'
    ? require('./auth').getCurrentUser()
    : null;

  if (isVip(user)) {
    // VIP 用户的档案数给一个宽松上限
    if (type === 'profileCount') {
      return { allowed: currentUsage <= 20, used: currentUsage, limit: 20 };
    }
    return { allowed: true };
  }

  switch (type) {
    case 'aiAnalysis': {
      const record = _getQuotaRecord('aiAnalysis');
      const limit = LIMITS.aiAnalysisDaily;
      if (record.count >= limit) {
        return {
          allowed: false,
          reason: `今日 AI 分析次数已用完（${limit}/${limit}）`,
          used: record.count,
          limit
        };
      }
      return { allowed: true, used: record.count, limit };
    }

    case 'profileCount': {
      const limit = LIMITS.maxProfiles;
      if (currentUsage >= limit) {
        return {
          allowed: false,
          reason: `免费版最多创建 ${limit} 个档案，升级 VIP 解锁更多`,
          used: currentUsage,
          limit
        };
      }
      return { allowed: true, used: currentUsage, limit };
    }

    case 'recycleBinRestore': {
      if (!LIMITS.recycleBinRestore) {
        return {
          allowed: false,
          reason: '恢复数据需要 VIP，免费版数据将在回收站保留 30 天后自动清除'
        };
      }
      return { allowed: true };
    }

    default:
      return { allowed: true };
  }
}

/**
 * 消耗一次配额（调用前应先 checkLimit 确认 allowed）
 *
 * @param {string} type - 'aiAnalysis'
 * @returns {number} 剩余次数
 */
function consumeQuota(type) {
  const record = _getQuotaRecord(type);
  record.count += 1;
  _saveQuotaRecord(type, record);

  const limit = LIMITS.aiAnalysisDaily;
  return Math.max(0, limit - record.count);
}

/**
 * 重置某项配额计数（用于测试或特殊场景）
 *
 * @param {string} type - 配额类型
 */
function resetQuota(type) {
  const key = QUOTA_PREFIX + type;
  wx.removeStorageSync(key);
}

/**
 * 获取当前用量概览（用于展示）
 *
 * @returns {Object} 用量统计
 */
function getQuotaOverview() {
  const vip = isVip();
  const aiRecord = _getQuotaRecord('aiAnalysis');

  return {
    isVip: vip,
    aiAnalysis: {
      used: aiRecord.count,
      limit: LIMITS.aiAnalysisDaily,
      remaining: Math.max(0, LIMITS.aiAnalysisDaily - aiRecord.count)
    },
    limits: { ...LIMITS }
  };
}

// ==================== 邀请码系统（云端校验，一码一人） ====================

/**
 * 兑换邀请码 — 调用云函数完成校验 + 激活
 * 校验逻辑全部在服务端，前端只负责传参和更新本地缓存
 *
 * @param {string} code - 用户输入的邀请码
 * @returns {Promise<{ success: boolean, reason?: string, expireAt?: string|null }>}
 */
async function redeemInviteCode(code) {
  if (!code || !code.trim()) {
    return { success: false, reason: '请输入邀请码' };
  }

  try {
    const user = auth.getCurrentUser();
    if (!user || !user.id) {
      return { success: false, reason: '请先登录后再兑换邀请码' };
    }

    const result = await callFunction('redeemInviteCode', {
      code: code.trim().toUpperCase(),
      userId: user.id,
    });

    if (result.code !== 0) {
      return { success: false, reason: result.message || '兑换失败' };
    }

    // 云端已激活成功，更新本地 VIP 缓存
    const expireAt = (result.data && result.data.expireAt) || (result.data && result.data.vipExpireAt) || null;
    setVipStatus({ isVip: true, expireAt });

    // 同步云端 VIP 字段到本地用户对象
    if (expireAt) user.vipExpireAt = expireAt;
    user.role = 'vip';

    return { success: true, expireAt };

  } catch (error) {
    console.warn('[vip] 兑换邀请码失败:', error && error.message || error);
    return { success: false, reason: (error && error.message) || '网络异常，请稍后再试' };
  }
}

module.exports = {
  isVip,
  setVipStatus,
  checkLimit,
  consumeQuota,
  resetQuota,
  getQuotaOverview,
  redeemInviteCode,
  LIMITS
};
