const { roundRect } = require('./chart');
const { getTotalScore, getDisplayTotalScore, getTotalFullScore, toPercent } = require('./format');

function fillLinearHeader(ctx, x, y, width, height, startColor, endColor) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, startColor);
  gradient.addColorStop(1, endColor);
  ctx.setFillStyle(gradient);
  ctx.fillRect(x, y, width, height);
}

function drawText(ctx, text, x, y, options = {}) {
  const {
    size = 14,
    color = '#2d2a26',
    align = 'left',
    bold = false
  } = options;
  ctx.setFillStyle(color);
  ctx.setFontSize(size);
  ctx.setTextAlign(align);
  if (bold) {
    ctx.font = `bold ${size}px sans-serif`;
  }
  ctx.fillText(String(text), x, y);
  ctx.font = '';
}

function formatPercentText(value) {
  return value === '--' ? '--' : `${value}%`;
}

function drawExamReport(ctx, payload) {
  const { exam, profileName, width } = payload;
  const subjects = exam.subjects || [];
  const totalScore = getDisplayTotalScore(exam);
  const totalFull = getTotalFullScore(subjects);
  const avgPct = toPercent(totalScore, totalFull, 1);
  const contentHeight = 260 + subjects.length * 62 + (exam.totalClassRank || exam.totalGradeRank ? 76 : 0);
  const height = Math.max(contentHeight, 640);

  if (!ctx) return height;

  ctx.clearRect(0, 0, width, height);
  ctx.setFillStyle('#f5f2ee');
  ctx.fillRect(0, 0, width, height);

  roundRect(ctx, 12, 12, width - 24, height - 24, 18, '#ffffff');
  fillLinearHeader(ctx, 12, 12, width - 24, 132, '#667eea', '#764ba2');
  drawText(ctx, '成绩雷达', 30, 44, { size: 12, color: 'rgba(255,255,255,0.82)' });
  drawText(ctx, exam.name, 30, 82, { size: 24, color: '#ffffff', bold: true });
  if (profileName) {
    drawText(ctx, profileName, 30, 108, { size: 13, color: 'rgba(255,255,255,0.88)' });
  }

  const cardsTop = 164;
  const cardWidth = (width - 64) / 4;
  [
    { label: '总分', value: totalScore },
    { label: '满分', value: totalFull },
    { label: '得分率', value: formatPercentText(avgPct) },
    { label: '科目', value: subjects.length }
  ].forEach((item, index) => {
    const x = 20 + index * (cardWidth + 8);
    roundRect(ctx, x, cardsTop, cardWidth, 68, 12, '#f8f7fc');
    drawText(ctx, item.value, x + cardWidth / 2, cardsTop + 34, { size: 18, color: '#667eea', align: 'center', bold: true });
    drawText(ctx, item.label, x + cardWidth / 2, cardsTop + 56, { size: 11, color: '#8a857f', align: 'center' });
  });

  let currentTop = 252;
  if (exam.totalClassRank || exam.totalGradeRank) {
    roundRect(ctx, 20, currentTop, width - 40, 60, 10, '#fef9f0');
    if (exam.totalClassRank) {
      const front = exam.classTotal ? ` (前${((exam.totalClassRank / exam.classTotal) * 100).toFixed(1)}%)` : '';
      drawText(ctx, `班级排名 第${exam.totalClassRank}名${front}`, 32, currentTop + 25, { size: 12, color: '#d4850a' });
    }
    if (exam.totalGradeRank) {
      const front = exam.gradeTotal ? ` (前${((exam.totalGradeRank / exam.gradeTotal) * 100).toFixed(1)}%)` : '';
      drawText(ctx, `年级排名 第${exam.totalGradeRank}名${front}`, 32, currentTop + 46, { size: 12, color: '#d4850a' });
    }
    currentTop += 78;
  }

  subjects.forEach((subject, index) => {
    const rowTop = currentTop + index * 58;
    const scoreColor = subject.score >= 90 ? '#52c41a' : subject.score >= 60 ? '#2d2a26' : '#f5222d';

    ctx.setStrokeStyle('#f0eeea');
    ctx.beginPath();
    ctx.moveTo(28, rowTop + 48);
    ctx.lineTo(width - 28, rowTop + 48);
    ctx.stroke();

    drawText(ctx, subject.name, 28, rowTop + 20, { size: 14, color: '#333333', bold: true });
    drawText(ctx, `${subject.score}/${subject.fullScore || 100}`, 130, rowTop + 22, { size: 17, color: scoreColor, bold: true });

    let tagX = width - 40;
    if (subject.gradeRank) {
      roundRect(ctx, tagX - 42, rowTop + 8, 38, 20, 10, '#f0f5ff');
      drawText(ctx, `校${subject.gradeRank}`, tagX - 23, rowTop + 22, { size: 10, color: '#4a7cc9', align: 'center' });
      tagX -= 48;
    }
    if (subject.classRank) {
      roundRect(ctx, tagX - 42, rowTop + 8, 38, 20, 10, '#f0f5ff');
      drawText(ctx, `班${subject.classRank}`, tagX - 23, rowTop + 22, { size: 10, color: '#4a7cc9', align: 'center' });
    }
  });

  if (exam.startDate) {
    drawText(ctx, `考试日期 ${exam.startDate}${exam.endDate && exam.endDate !== exam.startDate ? ` ~ ${exam.endDate}` : ''}`, 28, height - 38, { size: 11, color: '#999999' });
  }
  drawText(ctx, '由「成绩雷达」生成 · 记录每一步进步', width / 2, height - 16, { size: 10, color: '#cccccc', align: 'center' });

  return height;
}

function drawRing(ctx, centerX, centerY, radius, percent, color) {
  ctx.setStrokeStyle('#ece8e1');
  ctx.setLineWidth(8);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setStrokeStyle(color);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (percent / 100));
  ctx.stroke();
}

function drawProfileReport(ctx, payload) {
  const { profile, exams, width } = payload;
  const sorted = [...exams].sort((a, b) => new Date(a.startDate || a.createdAt || 0) - new Date(b.startDate || b.createdAt || 0));
  const latest = sorted[sorted.length - 1] || { subjects: [] };
  const latestTotal = getDisplayTotalScore(latest);
  const latestFull = getTotalFullScore(latest.subjects || []);
  const latestPct = toPercent(latestTotal, latestFull, 1);
  const subjectNames = Array.from(new Set(sorted.flatMap((exam) => (exam.subjects || []).map((subject) => subject.name))));
  const height = 700;

  if (!ctx) return height;

  ctx.clearRect(0, 0, width, height);
  ctx.setFillStyle('#f5f2ee');
  ctx.fillRect(0, 0, width, height);

  roundRect(ctx, 12, 12, width - 24, height - 24, 18, '#ffffff');
  fillLinearHeader(ctx, 12, 12, width - 24, 132, '#11998e', '#38ef7d');
  drawText(ctx, '成绩雷达 · 档案报告', 30, 44, { size: 12, color: 'rgba(255,255,255,0.82)' });
  drawText(ctx, profile.name, 30, 82, { size: 24, color: '#ffffff', bold: true });
  drawText(ctx, `共 ${sorted.length} 次考试 · ${subjectNames.length} 个科目`, 30, 108, { size: 13, color: 'rgba(255,255,255,0.88)' });

  const cardWidth = (width - 64) / 4;
  [
    { label: '最新总分', value: latestTotal },
    { label: '得分率', value: formatPercentText(latestPct) },
    { label: '科目', value: subjectNames.length },
    { label: '考试次数', value: sorted.length }
  ].forEach((item, index) => {
    const x = 20 + index * (cardWidth + 8);
    roundRect(ctx, x, 164, cardWidth, 68, 12, '#f5faf8');
    drawText(ctx, item.value, x + cardWidth / 2, 198, { size: 18, color: '#11998e', align: 'center', bold: true });
    drawText(ctx, item.label, x + cardWidth / 2, 220, { size: 11, color: '#8a857f', align: 'center' });
  });

  drawText(ctx, '得分率趋势（最近5次）', 28, 278, { size: 14, color: '#333333', bold: true });
  roundRect(ctx, 20, 292, width - 40, 150, 12, '#fafafa');
  const recent = sorted.slice(-5);
  const chartBottom = 408;
  const columnGap = (width - 70) / Math.max(recent.length, 1);
  recent.forEach((exam, index) => {
    const total = getDisplayTotalScore(exam);
    const full = getTotalFullScore(exam.subjects || []);
    const pct = Number(toPercent(total, full, 1)) || 0;
    const barHeight = Math.max(12, pct * 0.82);
    const barX = 36 + index * columnGap;
    const isLast = index === recent.length - 1;
    roundRect(ctx, barX, chartBottom - barHeight, 24, barHeight, 8, isLast ? '#38ef7d' : '#dff5ee');
    drawText(ctx, `${pct}%`, barX + 12, chartBottom + 18, { size: 10, color: isLast ? '#11998e' : '#8a857f', align: 'center' });
    drawText(ctx, String(exam.name || '').slice(-4), barX + 12, chartBottom + 34, { size: 9, color: '#b2aba4', align: 'center' });
  });

  drawText(ctx, '最新各科概况', 28, 476, { size: 14, color: '#333333', bold: true });
  const latestSubjects = (latest.subjects || []).slice(0, 8);
  latestSubjects.forEach((subject, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const x = 50 + col * 78;
    const y = 540 + row * 92;
    const percent = Number(toPercent(subject.score, subject.fullScore || 100, 0)) || 0;
    const color = subject.score >= 90 ? '#52c41a' : subject.score >= 60 ? '#11998e' : '#f5222d';
    drawRing(ctx, x, y, 20, percent, color);
    drawText(ctx, percent, x, y + 4, { size: 11, color: '#333333', align: 'center', bold: true });
    drawText(ctx, subject.name, x, y + 38, { size: 11, color: '#8a857f', align: 'center' });
  });

  drawText(ctx, '由「成绩管家」生成 · 记录每一步进步', width / 2, height - 18, { size: 10, color: '#cccccc', align: 'center' });
  return height;
}

module.exports = {
  drawExamReport,
  drawProfileReport
};
