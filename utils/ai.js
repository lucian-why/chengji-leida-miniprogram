/**
 * 成绩雷达 - 小程序端 AI 功能模块
 *
 * 提供两个核心能力：
 *  1. AI 成绩分析（优先使用 wx.cloud.extend.AI 小程序原生 AI）
 *  2. AI 批量成绩识别/录入
 *
 * 调用链路：
 *  小程序原生 AI（wx.cloud.extend.AI） → 云函数 ai_service → 本地降级分析
 *
 * 依赖：
 *  - utils/cloud.js   → callFunction（仅 fallback 用）
 *  - utils/auth.js    → getCurrentUser
 *  - utils/storage.js → getExams, getActiveProfileId
 */

const { callFunction } = require('./cloud');
const { getCurrentUser, getStoredToken } = require('./auth');
const { getExams, getActiveProfileId } = require('./storage');
const { getDisplayTotalScore } = require('./format');

// ==================== 常量 & 状态 ====================

const TEXT = {
  analysisEyebrow: 'AI 分析报告',
  analysisTitle: '成绩分析助手',
  analysisLoginTitle: '登录后即可使用 AI 分析',
  analysisLoginDesc: '登录后，AI 会结合当前档案的考试记录生成趋势判断、优势学科和改进建议。',
  analysisLoginAction: '去登录',
  analysisLoading: 'AI 正在阅读当前档案的成绩变化，请稍候片刻。',
  analysisRetry: '重试',
  analysisRefresh: '重新分析',
  analysisWorking: '分析中',
  analysisError: '这次分析没有成功，请稍后再试。',
  analysisNotEnoughTitle: '再多记录几场考试',
  analysisNotEnoughDesc: '至少记录 2 场考试后，AI 才能更稳定地看出趋势变化。',
  batchNeedText: '先输入一段成绩文本，再让 AI 帮你识别。',
  batchNeedLogin: '请先登录后再使用 AI 辅助录入。',
  batchPending: 'AI 正在识别成绩文本…',
  batchEmpty: '这段文字里没有识别出可回填的科目成绩。',
  batchParseFailed: 'AI 识别失败，请稍后再试',
  batchLoginPrompt: '登录后即可使用 AI 成绩分析和 AI 辅助录入。',
  // AI 对话文本
  chatTitleReport: 'AI 成绩对话',
  chatTitleCompare: 'AI 追问',
  chatTitleGlobal: 'AI 对话',
  chatPlaceholder: '输入你的问题…',
  chatBusy: 'AI 正在思考…',
  chatErrorRetry: '发送失败，请点击重试',
  chatContextReport: '请结合当前成绩分析报告，详细分析整体表现。',
  chatContextCompare: '请结合当前科目对比，分析优势科目、薄弱科目和提升建议。',
  chatContextGlobal: '你可以继续追问成绩、排名、科目变化和学习建议。',
  chatEntryReport: '想进一步了解成绩？和 AI 聊聊 →',
  chatEntryCompare: 'AI 追问'
};

function getAIAuthPayload() {
  const user = getCurrentUser();
  return {
    token: getStoredToken(),
    userId: user && user.id ? user.id : ''
  };
}

const MINI_PROGRAM_AI_PROVIDER = 'hunyuan-exp';
const MINI_PROGRAM_AI_MODEL = 'hunyuan-2.0-instruct-20251111';
const MINI_PROGRAM_AI_TIMEOUT = 15000;  // 原生 AI 超时 15 秒
const CLOUD_FUNCTION_TIMEOUT = 25000;   // 云函数超时 25 秒
const CHAT_AI_TIMEOUT = 20000;          // 对话模式超时 20 秒

let _analysisRequestToken = 0;
let _lastAnalysisKey = '';
let _lastAnalysisText = '';
let _lastAnalysisMeta = null;

// ==================== 工具函数 ====================

function normalizeExamDate(exam) {
  return exam.startDate || exam.endDate || exam.createdAt || '';
}

function buildAnalysisPayload(exams) {
  return exams
    .map((exam) => ({
      name: exam.name,
      date: normalizeExamDate(exam),
      totalScore: Number(
        exam.manualTotalScore ?? ((exam.subjects || []).reduce((sum, subject) => sum + (Number(subject.score) || 0), 0))
      ),
      totalClassRank: exam.totalClassRank || null,
      totalGradeRank: exam.totalGradeRank || null,
      classTotal: exam.classTotal || null,
      gradeTotal: exam.gradeTotal || null,
      subjects: (exam.subjects || []).map((subject) => ({
        name: subject.name,
        score: Number(subject.score) || 0,
        fullScore: Number(subject.fullScore) || 100,
        classRank: subject.classRank || null,
        gradeRank: subject.gradeRank || null
      }))
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * 格式化 AI 分析文本为 rich-text 可用的 HTML 片段
 *
 * 支持的 Markdown 语法：
 *   # ## ### #### → <h1>~<h4>
 *   - / * 无序列表  → <ul><li>
 *   1. 2. 有序列表  → <ol><li>
 *   **加粗**        → <strong>
 *   @image:name     → 占位提示（rich-text 不支持动态本地图片）
 *   ![alt](url)     → <img>
 *   双换行           → 分段
 *   单换行           → <br>
 */
function formatAnalysisHtml(text) {
  if (!text) return '';

  const raw = String(text);

  // ===== 按行解析，保留结构信息 =====
  const lines = raw.split('\n');
  const blocks = [];    // 输出 HTML 块
  let listStack = [];   // 列表栈：{ type: 'ul'|'ol', items: [] }
  let inList = false;

  function flushList() {
    if (!inList || listStack.length === 0) return;
    const list = listStack.pop();
    if (list.items.length > 0) {
      const tag = list.type;
      const inner = list.items.map(item => `<li>${item}</li>`).join('');
      blocks.push(`<${tag}>${inner}</${tag}>`);
    }
    inList = listStack.length > 0;
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 跳过空行（用 flushList + 空块分隔）
    if (/^\s*$/.test(line)) {
      flushList();
      blocks.push('');
      continue;
    }

    // ---------- 标题 ----------
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const content = escapeInline(headingMatch[2]).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      blocks.push(`<h${level}>${content}</h${level}>`);
      continue;
    }

    // ---------- 无序列表 (- 或 *) ----------
    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || (listStack.length > 0 && listStack[listStack.length - 1].type !== 'ul')) {
        flushList();
        listStack.push({ type: 'ul', items: [] });
        inList = true;
      }
      listStack[listStack.length - 1].items.push(formatInline(ulMatch[1]));
      continue;
    }

    // ---------- 有序列表 (1. 2. 等) ----------
    const olMatch = line.match(/^[\s]*(\d+)\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || (listStack.length > 0 && listStack[listStack.length - 1].type !== 'ol')) {
        flushList();
        listStack.push({ type: 'ol', items: [] });
        inList = true;
      }
      listStack[listStack.length - 1].items.push(formatInline(olMatch[2]));
      continue;
    }

    // ---------- 普通段落 ----------
    flushList();
    blocks.push(`<p>${formatInline(line)}</p>`);
  }

  // 结束时 flush 残留列表
  flushList();

  // 合并：相邻非空块之间不额外加空白，连续空块合并为段落间隔
  return blocks
    .filter((_, idx, arr) => {
      if (_ !== '') return true;
      const prevNonEmpty = arr.slice(0, idx).reverse().find(b => b !== '');
      const nextNonEmpty = arr.slice(idx + 1).find(b => b !== '');
      return prevNonEmpty && nextNonEmpty;
    })
    .map(block => block === '' ? '' : block)
    .join('');
}

/**
 * 格式化行内内容：转义 HTML 特殊字符 + 加粗 + 图片标签
 */
function formatInline(text) {
  let result = escapeInline(text);
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/@image:(\S+)/g, '<span style="color:#999;font-size:12px;">[图片: $1]</span>');
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:8px 0;"/>');
  return result;
}

/**
 * 转义 HTML 特殊字符（防止 XSS 和渲染异常）
 */
function escapeInline(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeParsedSubjects(subjects = []) {
  return subjects
    .map((subject) => ({
      name: String(subject?.name || '').trim(),
      score: subject?.score,
      fullScore: Number.isFinite(Number(subject?.fullScore)) ? Number(subject.fullScore) : 100,
      classRank: subject?.classRank ?? '',
      gradeRank: subject?.gradeRank ?? ''
    }))
    .filter(
      (subject) =>
        subject.name &&
        subject.score !== '' &&
        subject.score !== null &&
        subject.score !== undefined &&
        !Number.isNaN(Number(subject.score))
    );
}

// ==================== 小程序原生 AI ====================

function isMiniProgramAIAvailable() {
  return !!(
    typeof wx !== 'undefined' &&
    wx.cloud &&
    wx.cloud.extend &&
    wx.cloud.extend.AI &&
    typeof wx.cloud.extend.AI.createModel === 'function'
  );
}

function withTimeout(promise, timeout, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label || 'AI request'} timeout (${timeout}ms)`));
    }, timeout);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * 使用小程序原生 AI 调用大模型
 *
 * ⚠️ 关键 API 差异（来自微信官方文档）：
 * - generateText: 参数不需要 data 包裹，返回值是 { choices: [{ message: { content } }] }
 * - streamText: 参数需要 data 包裹，返回值是流式对象
 */
async function generateTextWithMiniProgramAI(messages, options = {}) {
  if (!isMiniProgramAIAvailable()) {
    console.warn('[AI] wx.cloud.extend.AI 不可用');
    throw new Error('wx.cloud.extend.AI is unavailable');
  }

  const modelName = options.model || MINI_PROGRAM_AI_MODEL;
  const timeout = options.timeout || MINI_PROGRAM_AI_TIMEOUT;
  console.log('[AI] 调用小程序原生 AI, model:', modelName, 'timeout:', timeout);

  const model = wx.cloud.extend.AI.createModel(MINI_PROGRAM_AI_PROVIDER);

  // generateText 参数直接传，不需要 data 包裹（streamText 才需要）
  const requestParams = {
    model: modelName,
    messages,
    temperature: options.temperature ?? 0.45
  };

  // 用手动 Promise + 超时，避免微信框架 Promise 不可控
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn('[AI] 小程序原生 AI 超时 (' + timeout + 'ms)');
      reject(new Error('小程序原生AI超时 (' + timeout + 'ms)'));
    }, timeout);

    try {
      model.generateText(requestParams).then((res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        console.log('[AI] 小程序原生 AI 原始返回类型:', typeof res, 'keys:', res ? Object.keys(res).join(',') : 'null');

        // 返回值是完整响应对象: { choices: [{ message: { content: "..." } }] }
        let text = '';
        if (res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) {
          text = String(res.choices[0].message.content).trim();
        } else if (typeof res === 'string') {
          // 兼容：某些版本可能直接返回 string
          text = res.trim();
        } else if (res && res.content) {
          // 兼容：另一种可能的返回格式
          text = String(res.content).trim();
        } else if (res && res.data && typeof res.data === 'string') {
          // 兼容：嵌套 data
          text = res.data.trim();
        }

        if (!text) {
          console.warn('[AI] 小程序原生 AI 返回内容为空, res:', JSON.stringify(res).substring(0, 300));
          reject(new Error('Mini Program AI returned empty content'));
          return;
        }

        console.log('[AI] 小程序原生 AI 成功, 文本长度:', text.length);
        resolve({
          text,
          source: 'miniprogram-ai'
        });
      }).catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const msg = err && (err.message || err.errMsg || err.msg || String(err));
        console.warn('[AI] 小程序原生 AI 失败:', msg);
        reject(new Error('小程序原生AI失败: ' + msg));
      });
    } catch (syncErr) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.warn('[AI] 小程序原生 AI 同步异常:', syncErr);
      reject(new Error('小程序原生AI同步异常: ' + (syncErr.message || String(syncErr))));
    }
  });
}

// ==================== API 1: AI 成绩分析 ====================

/**
 * 刷新 AI 分析卡片（供页面调用）
 *
 * @param {Object} options
 * @param {boolean} [options.force=false] - 强制刷新（忽略缓存）
 * @returns {Promise<Object>} { status, html, meta }
 */
async function refreshAIAnalysis({ force = false } = {}) {
  const profileId = getActiveProfileId();
  const exams = getExams(profileId, true);
  if (exams.length < 2) {
    return { status: 'notEnough', html: '', meta: null };
  }

  // 缓存命中？
  const payload = buildAnalysisPayload(exams);
  const cacheKey = JSON.stringify(payload);
  if (!force && cacheKey === _lastAnalysisKey && _lastAnalysisText) {
    return {
      status: 'success',
      html: formatAnalysisHtml(_lastAnalysisText),
      meta: _lastAnalysisMeta
    };
  }

  const requestToken = ++_analysisRequestToken;

  try {
    let aiText = '';
    let aiSource = '';
    let aiFallbackReason = '';

    // ① 优先使用小程序原生 AI
    console.log('[AI] refreshAIAnalysis: 尝试原生 AI (requestToken:', requestToken, ')');
    try {
      const direct = await generateTextWithMiniProgramAI([
        {
          role: 'system',
          content: '你是"成绩雷达"的 AI 学习分析助手。请基于用户提供的多场考试数据，直接输出简洁、具体、鼓励式的学习分析。输出请使用 Markdown，包含这 4 个部分：1. 趋势判断 2. 优势学科 3. 薄弱预警 4. 下一步建议。不要复述原始 JSON。'
        },
        {
          role: 'user',
          content: [
            '以下是同一档案下的考试数据，请直接输出分析结论：',
            JSON.stringify(payload, null, 2)
          ].join('\n')
        }
      ], {
        temperature: 0.45,
        timeout: 15000
      });
      aiText = direct.text;
      aiSource = direct.source;
    } catch (directError) {
      // ② 小程序原生 AI 失败，回退到云函数
      console.warn('[AI] 原生 AI 失败，回退云函数:', directError.message || directError);
      aiFallbackReason = directError.message || '小程序原生 AI 调用失败';

      try {
        console.log('[AI] 尝试云函数 ai_service, timeout:', CLOUD_FUNCTION_TIMEOUT);
        const result = await callFunction('ai_service', {
          ...getAIAuthPayload(),
          action: 'analyze',
          data: { exams: payload }
        }, { timeout: CLOUD_FUNCTION_TIMEOUT });

        if (requestToken !== _analysisRequestToken) {
          return { status: 'cancelled', html: '', meta: null };
        }

        if (result && result.code === 0 && result.data && result.data.text) {
          aiText = result.data.text;
          aiSource = result.data.source || 'cloud-function';
          if (result.data.fallbackReason) {
            aiFallbackReason = result.data.fallbackReason;
          }
        }
      } catch (cloudError) {
        console.warn('[AI] 云函数也失败:', cloudError.message || cloudError);
        aiFallbackReason += ' | 云函数也不可用';
      }
    }

    // 请求已被后续覆盖
    if (requestToken !== _analysisRequestToken) {
      return { status: 'cancelled', html: '', meta: null };
    }

    // ③ 如果以上都失败，降级到本地分析
    if (!aiText) {
      console.warn('[AI] 所有 AI 调用均失败，降级到本地分析');
      aiText = buildLocalFallbackAnalysis(payload);
      aiSource = 'local-fallback';
      aiFallbackReason = 'AI 服务暂不可用，当前为基础统计结果';
    }

    // 缓存结果
    _lastAnalysisKey = cacheKey;
    _lastAnalysisText = aiText;
    _lastAnalysisMeta = {
      source: aiSource,
      fallbackReason: aiFallbackReason
    };

    return {
      status: 'success',
      html: formatAnalysisHtml(aiText),
      meta: _lastAnalysisMeta
    };
  } catch (error) {
    if (requestToken !== _analysisRequestToken) {
      return { status: 'cancelled', html: '', meta: null };
    }
    return {
      status: 'error',
      html: '',
      meta: null
    };
  }
}

// ==================== API 2: AI 批量识别 ====================

/**
 * AI 批量识别成绩文本
 */
async function parseBatchSubjects(rawText, subjectHints = []) {
  const text = String(rawText || '').trim();
  if (!text) {
    return { success: false, message: TEXT.batchNeedText };
  }

  const user = getCurrentUser();
  if (!user) {
    return { success: false, needLogin: true, message: TEXT.batchNeedLogin };
  }

  try {
    let subjects = [];

    // ① 优先使用小程序原生 AI
    try {
      const direct = await generateTextWithMiniProgramAI([
        {
          role: 'system',
          content: '你是一个成绩录入解析助手。请从用户输入中提取科目成绩，并只返回 JSON 数组。每个元素格式为 {"name":"语文","score":120,"fullScore":150}。如果文本里有班排或年排，也可以附带 classRank、gradeRank。不要输出 Markdown，不要输出解释。'
        },
        {
          role: 'user',
          content: JSON.stringify({ text, subjectHints }, null, 2)
        }
      ], {
        temperature: 0.1,
        timeout: 10000
      });

      const match = String(direct.text).match(/\[[\s\S]*\]/);
      if (match) {
        subjects = normalizeParsedSubjects(JSON.parse(match[0]));
      }
    } catch (directError) {
      // ② 回退到云函数
      console.warn('[AI] 原生 AI 识别失败，回退云函数:', directError.message || directError);
      try {
        const result = await callFunction('ai_service', {
          ...getAIAuthPayload(),
          action: 'inputParse',
          data: { text, subjectHints }
        });
        if (result && result.code === 0) {
          subjects = normalizeParsedSubjects(result?.data?.subjects || []);
        }
      } catch (cloudError) {
        console.warn('[AI] 云函数识别也失败:', cloudError.message || cloudError);
      }
    }

    if (subjects.length === 0) {
      return { success: false, message: TEXT.batchEmpty };
    }

    return {
      success: true,
      subjects
    };
  } catch (error) {
    return {
      success: false,
      message: error?.message || TEXT.batchParseFailed
    };
  }
}

// ==================== 本地降级分析 ====================

function buildLocalFallbackAnalysis(exams) {
  const totals = exams.map(exam => Number(exam.totalScore) || 0);
  const first = totals[0];
  const last = totals[totals.length - 1];
  const delta = last - first;

  const subjectStats = new Map();
  exams.forEach((exam) => {
    (exam.subjects || []).forEach((subject) => {
      if (!subject.name || !subject.fullScore) return;
      const entry = subjectStats.get(subject.name) || { scores: [], rates: [] };
      const score = Number(subject.score) || 0;
      const fullScore = Number(subject.fullScore) || 100;
      entry.scores.push(score);
      entry.rates.push(score / fullScore);
      subjectStats.set(subject.name, entry);
    });
  });

  const summarizedSubjects = [...subjectStats.entries()].map(([name, entry]) => {
    const averageRate = entry.rates.reduce((sum, rate) => sum + rate, 0) / entry.rates.length;
    const trend = entry.scores.length >= 2 ? entry.scores[entry.scores.length - 1] - entry.scores[0] : 0;
    return { name, averageRate, trend };
  });

  const bestSubject = [...summarizedSubjects].sort((a, b) => b.averageRate - a.averageRate)[0];
  const weakSubject = [...summarizedSubjects].sort((a, b) => a.averageRate - b.averageRate)[0];

  const trendLine = delta > 0
    ? `📈 **趋势判断**\n最近 ${exams.length} 场考试总分整体在回升，从 ${first} 分提升到 ${last} 分，累计进步 ${delta} 分。`
    : delta < 0
      ? `📈 **趋势判断**\n最近 ${exams.length} 场考试总分有些波动，从 ${first} 分回落到 ${last} 分，先别焦虑，更值得看科目结构。`
      : `📈 **趋势判断**\n最近 ${exams.length} 场考试总分整体比较稳定，目前还在一个可以继续打磨细节的区间。`;

  const bestLine = bestSubject
    ? `💪 **优势学科**\n${bestSubject.name} 的得分率最稳，平均约 ${(bestSubject.averageRate * 100).toFixed(0)}%，可以继续把它当作总分兜底科目。`
    : '💪 **优势学科**\n当前有效数据还不够多，先继续记录几场考试，AI 才能更稳定地看出你的强项。';

  const weakLine = weakSubject
    ? `⚠️ **薄弱预警**\n${weakSubject.name} 目前是更需要关注的一科，平均得分率约 ${(weakSubject.averageRate * 100).toFixed(0)}%，建议优先回看最近失分点。`
    : '⚠️ **薄弱预警**\n当前还没有足够的科目数据去判断薄弱项，先把每次考试记录完整。';

  const nextLine = weakSubject
    ? `🎯 **下一步建议**\n先把 ${weakSubject.name} 的基础题和高频错点稳住，再维持 ${bestSubject?.name || '优势学科'} 的稳定发挥，会比平均用力更有效。`
    : '🎯 **下一步建议**\n继续补全考试记录，并优先保持每场考试的数据完整，后面 AI 给出的建议会更具体。';

  return [trendLine, bestLine, weakLine, nextLine].join('\n\n');
}

// ==================== API 3: AI 对话 ====================

/**
 * 构建对话系统提示词
 * @param {'report'|'compare'|'global'} source - 入口来源
 * @param {object} [extra] - 附加数据
 * @returns {string} 系统提示词
 */
function buildChatSystemPrompt(source = 'global', extra = {}) {
  const profileId = getActiveProfileId();
  const exams = getExams(profileId, true);
  const examSummary = exams.slice(-6).map(exam => {
    const subjects = (exam.subjects || []).map(s => `${s.name}:${s.score}/${s.fullScore || 100}`).join(', ');
    return `${exam.name}(${exam.startDate || exam.createdAt || ''}) 总分:${getDisplayTotalScore(exam)} ${subjects ? '[' + subjects + ']' : ''}`;
  }).join('\n');

  let prompt = `你是"成绩雷达"的 AI 学习分析助手，正在和用户进行一对一对话。

当前档案的考试数据（最近几场）：
${examSummary || '暂无考试数据'}

对话规则：
1. 根据用户的提问和提供的考试数据，给出有针对性的分析和建议。
2. 语言温和、简洁、有具体建议，不要空泛鸡汤。
3. 可以引用具体的考试数据来支撑你的分析，但不要编造数据。
4. 如果信息不足以回答，就明确说"当前数据还不够"。
5. 回答控制在 300 字以内，除非用户明确要求详细分析。
6. "下一步建议"必须是具体动作，而不是泛泛鼓励。
7. 如果用户问的问题与成绩/学习无关，礼貌地引导回成绩话题。`;

  // 报告入口：附上分析报告
  if (source === 'report' && extra.analysisText) {
    prompt += `\n\n当前 AI 分析报告内容：\n${extra.analysisText}`;
  }

  // 科目对比入口：附上对比数据
  if (source === 'compare' && extra.compareData) {
    prompt += `\n\n当前科目对比数据：\n${JSON.stringify(extra.compareData, null, 2)}`;
  }

  return prompt;
}

/**
 * 发送 AI 对话消息
 *
 * @param {object} options
 * @param {Array<{role:string,content:string}>} options.messages - 完整消息列表（含 system + 历史）
 * @param {number} [options.timeout=20000] - 超时时间
 * @returns {Promise<{text:string,source:string}>}
 */
async function sendChatMessage({ messages, timeout } = {}) {
  const actualTimeout = timeout || CHAT_AI_TIMEOUT;

  // ① 优先使用小程序原生 AI
  try {
    const result = await generateTextWithMiniProgramAI(messages, {
      temperature: 0.5,
      timeout: actualTimeout
    });
    return result;
  } catch (directError) {
    console.warn('[AI] 原生 AI 对话失败，回退云函数:', directError.message || directError);
  }

  // ② 回退到云函数 chat action
  try {
    const result = await callFunction('ai_service', {
      ...getAIAuthPayload(),
      action: 'chat',
      data: { messages }
    }, { timeout: CLOUD_FUNCTION_TIMEOUT });

    if (result && result.code === 0 && result.data && result.data.text) {
      return {
        text: String(result.data.text).trim(),
        source: result.data.source || 'cloud-function'
      };
    }
    throw new Error(result?.message || '云函数未返回有效内容');
  } catch (cloudError) {
    console.warn('[AI] 云函数对话也失败:', cloudError.message || cloudError);
    throw new Error('AI 对话暂时不可用，请稍后再试');
  }
}

/**
 * 构建科目对比数据（供入口传递给对话页）
 * @param {string} currentExamId - 当前考试 ID
 * @param {Array} selectedCompareIds - 选中的对比考试 ID 列表
 * @returns {object|null}
 */
function buildCompareData(currentExamId, selectedCompareIds = []) {
  const profileId = getActiveProfileId();
  const exams = getExams(profileId, true);
  const currentExam = exams.find(e => e.id === currentExamId);
  if (!currentExam) return null;

  return {
    currentExam: {
      name: currentExam.name,
      subjects: (currentExam.subjects || []).map(s => ({
        name: s.name,
        score: s.score,
        fullScore: s.fullScore || 100,
        rate: ((s.score / (s.fullScore || 100)) * 100).toFixed(1) + '%'
      }))
    },
    compareExams: selectedCompareIds.map(id => {
      const exam = exams.find(e => e.id === id);
      if (!exam) return null;
      return {
        name: exam.name,
        subjects: (exam.subjects || []).map(s => ({
          name: s.name,
          score: s.score,
          fullScore: s.fullScore || 100,
          rate: ((s.score / (s.fullScore || 100)) * 100).toFixed(1) + '%'
        }))
      };
    }).filter(Boolean)
  };
}

// ==================== 导出 ====================

module.exports = {
  refreshAIAnalysis,
  parseBatchSubjects,
  buildLocalFallbackAnalysis,
  buildAnalysisPayload,
  TEXT,
  formatAnalysisHtml,
  sendChatMessage,
  buildChatSystemPrompt,
  buildCompareData,
  get _lastAnalysisText() { return _lastAnalysisText; }
};
