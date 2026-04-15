const APP_ID = 'wx07532e8f45b25fe6';
const ENV_ID = 'chengjiguanjia-1g1twvrkd736c880';

let initialized = false;

function initCloud() {
  if (initialized) return;
  if (!wx.cloud) {
    console.warn('[cloud] wx.cloud is not available');
    return;
  }

  try {
    wx.cloud.init({
      env: ENV_ID,
      appid: APP_ID,
      traceUser: true
    });
    initialized = true;
  } catch (error) {
    console.warn('[cloud] init failed:', error);
  }
}

function normalizeTimeoutError(name, timeout) {
  return new Error(`云函数 ${name} 调用超时（${timeout / 1000}s），请稍后重试`);
}

function normalizeCloudCallError(name, error) {
  const rawMessage = String(error?.errMsg || error?.message || error || '');
  const requestId = error?.requestID || error?.requestId || '';
  const suffix = requestId ? `（requestId: ${requestId}）` : '';

  if (/errCode:\s*-601002/i.test(rawMessage) || /system error/i.test(rawMessage)) {
    return new Error(`云端服务暂时不稳定，请稍后再试${suffix}`);
  }

  if (/cloud\.callFunction:fail/i.test(rawMessage)) {
    return new Error(`云函数 ${name} 调用失败，请检查网络或稍后再试${suffix}`);
  }

  if (error instanceof Error && error.message) {
    return error;
  }

  return new Error(rawMessage || `云函数 ${name} 调用失败`);
}

function invokeFunction(name, data, timeout) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('当前微信版本不支持云开发能力'));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`CLOUD_FUNCTION_TIMEOUT:${name}:${timeout}`));
    }, timeout);

    wx.cloud.callFunction({
      name,
      data: data || {},
      config: { timeout },
      success(res) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res.result || res);
      },
      fail(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function callFunction(name, data, options = {}) {
  initCloud();

  const timeout = options.timeout || 20000;
  const retries = Number.isInteger(options.retries) ? options.retries : 1;

  return new Promise((resolve, reject) => {
    const run = (attempt) => {
      invokeFunction(name, data, timeout)
        .then(resolve)
        .catch((error) => {
          const message = String(error?.errMsg || error?.message || error || '');
          const isTimeout = /timeout/i.test(message) || message.indexOf('CLOUD_FUNCTION_TIMEOUT:') === 0;

          if (isTimeout && attempt < retries) {
            console.warn(`[cloud] callFunction timeout, retrying ${name} (${attempt + 1}/${retries})`);
            run(attempt + 1);
            return;
          }

          if (isTimeout) {
            reject(normalizeTimeoutError(name, timeout));
            return;
          }

          console.warn('[cloud] callFunction failed:', name, error);
          reject(normalizeCloudCallError(name, error));
        });
    };

    run(0);
  });
}

module.exports = {
  ENV_ID,
  initCloud,
  callFunction
};
