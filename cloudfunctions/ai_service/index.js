const tcb = require('@cloudbase/node-sdk');
const { analyzePrompt } = require('./prompts/analyze');
const { inputParsePrompt } = require('./prompts/inputParse');
const { chatPrompt } = require('./prompts/chat');

const app = tcb.init({
  env: process.env.CLOUDBASE_ENV_ID || tcb.SYMBOL_CURRENT_ENV,
  secretId: process.env.CLOUDBASE_SECRETID,
  secretKey: process.env.CLOUDBASE_SECRETKEY,
  timeout: 60000
});

const ai = app.ai();
const AI_PROVIDER = process.env.AI_PROVIDER || 'hunyuan-exp';
const AI_MODEL = process.env.AI_MODEL || 'hunyuan-2.0-instruct-20251111';
const AI_BASE_URL = String(process.env.AI_BASE_URL || '').trim();
const AI_API_KEY = String(process.env.AI_API_KEY || '').trim();

const DEFAULT_SUBJECTS = [
  '语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治',
  '道法', '科学', '文综', '理综', '日语'
];

exports.main = async (event = {}) => {
  console.log('[ai_service] raw event:', safeStringify(event));
  const payload = parseEventPayload(event);
  const action = String(payload.action || '').trim();
  const data = payload.data || {};

  try {
    if (action === 'analyze') {
      return await handleAnalyze(data);
    }

    if (action === 'inputParse') {
      return await handleInputParse(data);
    }

    if (action === 'chat') {
      return await handleChat(data);
    }

    return { code: 400, message: '不支持的 AI action' };
  } catch (error) {
    console.error('[ai_service] error:', error);
    return {
      code: 500,
      message: error?.message || 'AI 服务暂时不可用'
    };
  }
};

function parseEventPayload(event = {}) {
  if (typeof event === 'string' && event.trim()) {
    try {
      return JSON.parse(event);
    } catch {
      return {};
    }
  }

  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return {};
  }

  if (event.action || event.data) return event;

  if (event.body && typeof event.body === 'object' && !Array.isArray(event.body)) {
    if (event.body.action || event.body.data) return event.body;
  }

  if (typeof event.body === 'string' && event.body.trim()) {
    try {
      const parsed = JSON.parse(event.body);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return {};
    }
  }

  if (typeof event.payload === 'string' && event.payload.trim()) {
    try {
      const parsed = JSON.parse(event.payload);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return {};
    }
  }

  if (event.queryStringParameters && typeof event.queryStringParameters === 'object') {
    return event.queryStringParameters;
  }

  return {};
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

async function handleAnalyze(data = {}) {
  const exams = sanitizeExams(data.exams);
  if (exams.length < 2) {
    return { code: 400, message: '至少需要 2 场考试才能生成 AI 分析' };
  }

  const userContent = [
    '以下是同一档案下的考试数据，请直接输出分析结论：',
    JSON.stringify(exams, null, 2)
  ].join('\n');

  try {
    const text = await generateWithAI([
      { role: 'system', content: analyzePrompt },
      { role: 'user', content: userContent }
    ], { temperature: 0.45, maxTokens: 900 });

    if (!String(text || '').trim()) {
      throw new Error('AI 没有返回有效分析内容');
    }

    return {
      code: 0,
      data: {
        text: String(text).trim(),
        source: AI_API_KEY && AI_BASE_URL ? 'custom-openai-compatible' : 'cloudbase-ai'
      }
    };
  } catch (error) {
    const fallbackReason = normalizeAIError(error);
    console.warn('[ai_service] analyze fallback:', fallbackReason);
    return {
      code: 0,
      data: {
        text: buildFallbackAnalysis(exams),
        source: 'fallback',
        fallbackReason,
        needsConfiguration: isConfigurationError(fallbackReason)
      }
    };
  }
}

async function handleInputParse(data = {}) {
  const text = String(data.text || '').trim();
  const subjectHints = Array.isArray(data.subjectHints)
    ? data.subjectHints.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  const subjectContext = Array.isArray(data.subjectContext) ? data.subjectContext : [];

  if (!text) {
    return { code: 400, message: '请先输入需要识别的成绩文本' };
  }

  const localParsed = parseSubjectsLocally(text, subjectHints);
  if (localParsed.length > 0) {
    // 即使本地匹配到，也检查是否是对已有科目成绩的修改
    const merged = mergeWithExistingContext(localParsed, subjectContext);
    return {
      code: 0,
      data: {
        subjects: merged,
        source: 'fallback'
      }
    };
  }

  try {
    const userPayload = { text, subjectHints };
    if (subjectContext.length > 0) {
      userPayload.currentSubjects = subjectContext;
    }
    const responseText = await generateWithAI([
      { role: 'system', content: inputParsePrompt },
      {
        role: 'user',
        content: JSON.stringify(userPayload, null, 2)
      }
    ], { temperature: 0.1, maxTokens: 500 });

    const parsed = parseSubjectsFromAIText(responseText);
    if (!parsed.length) {
      return { code: 422, message: '这段文字里没有识别出可回填的科目成绩' };
    }

    return {
      code: 0,
      data: {
        subjects: parsed,
        source: AI_API_KEY && AI_BASE_URL ? 'custom-openai-compatible' : 'cloudbase-ai'
      }
    };
  } catch (error) {
    console.error('[ai_service] inputParse error:', error);
    return { code: 500, message: normalizeAIError(error) || 'AI 识别失败，请稍后再试' };
  }
}

async function generateWithAI(messages, options = {}) {
  if (AI_API_KEY && AI_BASE_URL) {
    return generateWithOpenAICompatible(messages, options);
  }
  return generateWithCloudBaseAI(messages, options);
}

async function generateWithCloudBaseAI(messages, options = {}) {
  const model = ai.createModel(AI_PROVIDER);
  const result = await model.generateText({
    model: AI_MODEL,
    messages,
    temperature: options.temperature ?? 0.4,
    maxTokens: options.maxTokens ?? 900
  });

  if (result?.error) {
    const errorMessage = typeof result.error === 'string'
      ? result.error
      : (result.error?.message || JSON.stringify(result.error));
    throw new Error(errorMessage || 'CloudBase AI 调用失败');
  }

  return result?.text || '';
}

async function generateWithOpenAICompatible(messages, options = {}) {
  const baseUrl = AI_BASE_URL.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 900
    })
  });

  if (!response.ok) {
    let detail = '';
    try {
      const data = await response.json();
      detail = data?.error?.message || data?.message || JSON.stringify(data);
    } catch {
      detail = await response.text();
    }
    throw new Error(`OpenAI-compatible AI 调用失败 (${response.status})${detail ? `: ${detail}` : ''}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

function normalizeAIError(error) {
  const message = String(error?.message || error || '').trim();
  if (!message) return 'unknown';

  if (/status code 401/i.test(message) || /unauthorized/i.test(message)) {
    return '当前环境的 AI 模型尚未正确配置或授权，请在 CloudBase ai+ 控制台补充 DeepSeek/Hunyuan 的 API Key 后再试。';
  }

  if (/status code 429/i.test(message) || /rate limit/i.test(message) || /quota/i.test(message) || /too many requests/i.test(message)) {
    return 'AI 模型调用额度已用尽或请求过于频繁，请稍后再试，或在 CloudBase ai+ 控制台检查配额。';
  }

  if (/api key/i.test(message) || /invalid api key/i.test(message)) {
    return 'AI 模型 API Key 无效或未配置，请检查 CloudBase ai+ 配置。';
  }

  return message;
}

function isConfigurationError(message) {
  return /配置|授权|API Key|尚未正确配置|未配置/.test(String(message || ''));
}

function sanitizeExams(exams = []) {
  return (Array.isArray(exams) ? exams : [])
    .slice(-12)
    .map((exam) => ({
      name: String(exam?.name || '').trim(),
      date: String(exam?.date || '').trim(),
      totalScore: Number(exam?.totalScore) || 0,
      totalClassRank: normalizeNullableNumber(exam?.totalClassRank),
      totalGradeRank: normalizeNullableNumber(exam?.totalGradeRank),
      classTotal: normalizeNullableNumber(exam?.classTotal),
      gradeTotal: normalizeNullableNumber(exam?.gradeTotal),
      subjects: (Array.isArray(exam?.subjects) ? exam.subjects : [])
        .map((subject) => ({
          name: String(subject?.name || '').trim(),
          score: Number(subject?.score) || 0,
          fullScore: Number(subject?.fullScore) || 100,
          classRank: normalizeNullableNumber(subject?.classRank),
          gradeRank: normalizeNullableNumber(subject?.gradeRank)
        }))
        .filter((subject) => subject.name)
    }))
    .filter((exam) => exam.name);
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function buildFallbackAnalysis(exams) {
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

function parseSubjectsFromAIText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeParsedSubject).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeParsedSubject(item) {
  const name = String(item?.name || '').trim();
  const score = Number(item?.score);
  if (!name || Number.isNaN(score)) return null;

  const subject = {
    name,
    score,
    fullScore: Number.isNaN(Number(item?.fullScore)) ? 100 : Number(item.fullScore)
  };

  const classRank = normalizeNullableNumber(item?.classRank);
  const gradeRank = normalizeNullableNumber(item?.gradeRank);
  if (classRank !== null) subject.classRank = classRank;
  if (gradeRank !== null) subject.gradeRank = gradeRank;
  return subject;
}

function parseSubjectsLocally(text, subjectHints = []) {
  const hints = [...new Set([...DEFAULT_SUBJECTS, ...subjectHints].map(item => String(item || '').trim()).filter(Boolean))];
  const normalizedText = String(text || '')
    .replace(/[，、。]/g, ' ')
    .replace(/\s*(?:改成?|改为|修改为?|调整为?|更正为?|→|➡|->)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const subjects = [];

  hints.forEach((subjectName) => {
    const pattern = new RegExp(`${escapeRegExp(subjectName)}\\s*[:：]?\\s*(\\d{1,3})(?:\\s*(?:分|/)?\\s*(?:满分)?\\s*(\\d{2,3}))?`, 'gi');
    let match = pattern.exec(normalizedText);
    while (match) {
      const score = Number(match[1]);
      if (!Number.isNaN(score)) {
        const nearby = normalizedText.slice(match.index, match.index + 28);
        const classRankMatch = nearby.match(/班(?:排|名次)?\s*(\d{1,4})/);
        const gradeRankMatch = nearby.match(/年(?:排|名次)?\s*(\d{1,4})/);

        const subject = {
          name: subjectName,
          score,
          fullScore: match[2] ? Number(match[2]) : 100
        };

        if (classRankMatch) subject.classRank = Number(classRankMatch[1]);
        if (gradeRankMatch) subject.gradeRank = Number(gradeRankMatch[1]);
        subjects.push(subject);
      }
      match = pattern.exec(normalizedText);
    }
  });

  const deduped = new Map();
  subjects.forEach((subject) => {
    deduped.set(subject.name.toLowerCase(), subject);
  });
  return [...deduped.values()];
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mergeWithExistingContext(parsed, subjectContext = []) {
  if (!subjectContext.length) return parsed;
  return parsed;
}

async function handleChat(data = {}) {
  const rawMessages = Array.isArray(data.messages) ? data.messages : [];

  if (rawMessages.length === 0) {
    return { code: 400, message: '对话消息不能为空' };
  }

  // 限制消息数量，防止 token 爆炸
  const messages = rawMessages.slice(-42).map(msg => ({
    role: String(msg.role || 'user').trim(),
    content: String(msg.content || '').trim()
  })).filter(msg => msg.content && ['system', 'user', 'assistant'].includes(msg.role));

  // 如果第一条不是 system，插入默认 system prompt
  if (messages.length === 0 || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: chatPrompt });
  }

  try {
    const text = await generateWithAI(messages, { temperature: 0.6, maxTokens: 600 });

    if (!String(text || '').trim()) {
      throw new Error('AI 没有返回有效内容');
    }

    return {
      code: 0,
      data: {
        text: String(text).trim(),
        source: AI_API_KEY && AI_BASE_URL ? 'custom-openai-compatible' : 'cloudbase-ai'
      }
    };
  } catch (error) {
    console.error('[ai_service] chat error:', error);
    return {
      code: 500,
      message: normalizeAIError(error) || 'AI 对话暂时不可用，请稍后再试'
    };
  }
}
