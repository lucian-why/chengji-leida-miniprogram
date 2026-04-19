function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function parseFiniteNumber(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { ok: false, message: `请输入有效${label}` };
  }
  return { ok: true, value: num };
}

function parsePositiveNumber(value, label) {
  const parsed = parseFiniteNumber(value, label);
  if (!parsed.ok) return parsed;
  if (parsed.value <= 0) {
    return { ok: false, message: `${label}必须大于 0` };
  }
  return parsed;
}

function parseNonNegativeNumber(value, label) {
  const parsed = parseFiniteNumber(value, label);
  if (!parsed.ok) return parsed;
  if (parsed.value < 0) {
    return { ok: false, message: `${label}不能为负数` };
  }
  return parsed;
}

function parseOptionalPositiveInteger(value, label) {
  if (value === '' || value === null || value === undefined) {
    return { ok: true, value: undefined };
  }
  const parsed = parseFiniteNumber(value, label);
  if (!parsed.ok) return parsed;
  if (!Number.isInteger(parsed.value) || parsed.value <= 0) {
    return { ok: false, message: `${label}必须为正整数` };
  }
  return parsed;
}

function parseScoreFields(score, fullScore, label) {
  const full = fullScore === '' || fullScore === null || fullScore === undefined
    ? { ok: true, value: 100 }
    : parsePositiveNumber(fullScore, `${label}满分`);
  if (!full.ok) return full;

  const scoreResult = parseNonNegativeNumber(score, `${label}成绩`);
  if (!scoreResult.ok) return scoreResult;
  if (scoreResult.value > full.value) {
    return { ok: false, message: `${label}成绩不能超过满分` };
  }

  return { ok: true, score: scoreResult.value, fullScore: full.value };
}

function parseRankPair(rankValue, totalValue, rankLabel, totalLabel) {
  const rank = parseOptionalPositiveInteger(rankValue, rankLabel);
  if (!rank.ok) return rank;
  const total = parseOptionalPositiveInteger(totalValue, totalLabel);
  if (!total.ok) return total;
  if (rank.value !== undefined && total.value !== undefined && rank.value > total.value) {
    return { ok: false, message: `${rankLabel}不能大于${totalLabel}` };
  }
  return { ok: true, rank: rank.value, total: total.value };
}

module.exports = {
  isFiniteNumber,
  parseFiniteNumber,
  parsePositiveNumber,
  parseNonNegativeNumber,
  parseOptionalPositiveInteger,
  parseScoreFields,
  parseRankPair
};
