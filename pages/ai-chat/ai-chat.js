/**
 * 成绩雷达 - AI 对话页面
 *
 * 入口：
 *   1. AI 分析报告后 "和 AI 聊聊" 按钮
 *   2. 科目对比旁 "AI 追问" 按钮
 *
 * 页面参数：
 *   source: 'report' | 'compare' | 'global'
 *   analysisText: 报告文本（report 入口时传入）
 *   compareData: JSON 字符串化的对比数据（compare 入口时传入）
 */

const ai = require('../../utils/ai');
const auth = require('../../utils/auth');
const vip = require('../../utils/vip');
const { getExams, getActiveProfileId } = require('../../utils/storage');
const AI_LIMITS = ai.AI_LIMITS || {
  chatContentChars: 1200,
  chatMessages: 21
};

Page({
  data: {
    messages: [],       // { role: 'user'|'assistant', content: string, html: string, isError?: boolean }
    inputText: '',
    canSend: false,
    isBusy: false,
    isLoggedIn: false,
    hasExamData: false,
    isVip: false,
    chatUsed: 0,
    chatLimit: 2,
    scrollToId: '',
    source: 'global'
  },

  // 内部状态
  _chatContext: null,  // { type, data }
  _systemPrompt: '',

  onLoad(options) {
    const source = options.source || 'global';
    const analysisText = options.analysisText ? decodeURIComponent(options.analysisText) : '';
    let compareData = null;
    try {
      compareData = options.compareData ? JSON.parse(decodeURIComponent(options.compareData)) : null;
    } catch (e) {
      compareData = null;
    }

    this._chatContext = { type: source, data: {} };
    if (source === 'report' && analysisText) {
      this._chatContext.data.analysisText = analysisText;
    }
    if (source === 'compare' && compareData) {
      this._chatContext.data.compareData = compareData;
    }

    // 设置导航栏标题
    const titles = {
      report: ai.TEXT.chatTitleReport,
      compare: ai.TEXT.chatTitleCompare,
      global: ai.TEXT.chatTitleGlobal
    };
    wx.setNavigationBarTitle({ title: titles[source] || titles.global });

    // 构建系统提示
    this._systemPrompt = ai.buildChatSystemPrompt(source, this._chatContext.data);

    // 检查登录和数据
    const user = auth.getCurrentUser();
    const profileId = getActiveProfileId();
    const exams = getExams(profileId, true);
    const isVipUser = vip.isVip(user);
    const chatQuota = vip.checkLimit('aiChat');

    this.setData({
      source,
      isLoggedIn: !!user,
      hasExamData: exams.length >= 1,
      isVip: isVipUser,
      chatUsed: chatQuota.used || 0,
      chatLimit: chatQuota.limit || 2
    });

    // 插入开场消息
    if (user && exams.length >= 1) {
      const openingText = source === 'report' ? ai.TEXT.chatContextReport
        : source === 'compare' ? ai.TEXT.chatContextCompare
        : ai.TEXT.chatContextGlobal;

      this.setData({
        messages: [{
          role: 'assistant',
          content: openingText,
          html: ai.formatAnalysisHtml(openingText)
        }]
      });
    }
  },

  onInput(e) {
    this.setData({
      inputText: e.detail.value,
      canSend: !this.data.isBusy && e.detail.value.trim().length > 0
    });
  },

  async onSend() {
    const text = String(this.data.inputText || '').trim();
    if (!text || this.data.isBusy) return;
    if (text.length > AI_LIMITS.chatContentChars) {
      wx.showToast({
        title: `单次最多 ${AI_LIMITS.chatContentChars} 字`,
        icon: 'none'
      });
      return;
    }

    // VIP 配额检查
    const chatQuota = vip.checkLimit('aiChat');
    if (!chatQuota.allowed) {
      this._addAssistantMessage(
        `今日 AI 对话次数已用完（${chatQuota.limit}轮/${chatQuota.limit}），明天再来聊吧~ 升级 VIP 可解除限制。`,
        true
      );
      wx.showModal({
        title: '对话次数已用完',
        content: '免费版每天可进行有限次对话，升级 VIP 解锁无限畅聊。',
        confirmText: '获取VIP',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            this.showVipGuide();
          }
        }
      });
      return;
    }

    // 添加用户消息
    const userMsg = { role: 'user', content: text };
    const messages = [...this.data.messages, userMsg];
    this.setData({ inputText: '', canSend: false, messages, isBusy: true });
    this._scrollToBottom();

    try {
      // 构建 AI 消息列表
      const aiMessages = this._buildAIMessages();
      const result = await ai.sendChatMessage({ messages: aiMessages });

      // 消耗配额
      vip.consumeQuota('aiChat');
      const newQuota = vip.checkLimit('aiChat');

      this._addAssistantMessage(result.text);
      this.setData({
        chatUsed: newQuota.used || 0,
        chatLimit: newQuota.limit || 2
      });
    } catch (error) {
      this._addAssistantMessage(ai.TEXT.chatErrorRetry, true);
      wx.showToast({ title: 'AI 对话失败', icon: 'none' });
    } finally {
      this.setData({ isBusy: false, canSend: this.data.inputText.trim().length > 0 });
      this._scrollToBottom();
    }
  },

  _addAssistantMessage(content, isError = false) {
    const msg = {
      role: 'assistant',
      content,
      html: ai.formatAnalysisHtml(content),
      isError
    };
    this.setData({ messages: [...this.data.messages, msg] });
    this._scrollToBottom();
  },

  _buildAIMessages() {
    const messages = [{ role: 'system', content: this._systemPrompt }];
    // 20 条历史 + 1 条 system，和云函数上限保持一致。
    const recent = this.data.messages.slice(-(AI_LIMITS.chatMessages - 1));
    recent.forEach(msg => {
      if (msg.isError) return;
      messages.push({
        role: msg.role,
        content: String(msg.content || '').slice(0, AI_LIMITS.chatContentChars)
      });
    });
    return messages;
  },

  _scrollToBottom() {
    setTimeout(() => {
      this.setData({ scrollToId: 'msg-bottom' });
    }, 100);
  },

  showVipGuide() {
    console.log('[VIP] showVipGuide triggered in ai-chat');
    setTimeout(() => {
      wx.showModal({
        title: '获取官方兑换码',
        content: '请在 🐟闲置APP 中搜索关键词【成绩雷达小程序VIP】获取官方正版兑换码。点击下方按钮可直接复制搜索词。',
        confirmText: '去复制',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            wx.setClipboardData({
              data: '成绩雷达小程序VIP',
              success: () => {
                wx.showToast({ title: '已复制搜索词', icon: 'success' });
              }
            });
          }
        }
      });
    }, 300);
  }
});
