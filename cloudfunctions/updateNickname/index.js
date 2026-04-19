const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const userId = event.userId || '';
  const nickname = String(event.nickname || '').trim();

  if (!userId) return { code: -1, message: '缺少用户 ID' };
  if (!nickname) return { code: -1, message: '请输入昵称' };
  if (nickname.length > 24) return { code: -1, message: '昵称最多 24 个字符' };

  try {
    await db.collection('users').doc(userId).update({
      data: {
        nickname,
        updatedAt: new Date()
      }
    });
    return { code: 0, data: { nickname } };
  } catch (err) {
    console.error('[updateNickname] error:', err);
    return { code: 500, message: '昵称更新失败' };
  }
};
