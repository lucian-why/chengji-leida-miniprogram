function roundRect(ctx, x, y, width, height, radius, fillColor, strokeColor) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  if (fillColor) {
    ctx.setFillStyle(fillColor);
    ctx.fill();
  }
  if (strokeColor) {
    ctx.setStrokeStyle(strokeColor);
    ctx.stroke();
  }
}

function truncateLabel(label, max = 5) {
  const text = String(label || '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function drawPoint(ctx, type, x, y, size, color) {
  ctx.setFillStyle(color);
  ctx.setStrokeStyle(color);
  ctx.beginPath();
  if (type === 'rect') {
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
    return;
  }
  if (type === 'triangle') {
    ctx.moveTo(x, y - size * 1.4);
    ctx.lineTo(x + size * 1.25, y + size);
    ctx.lineTo(x - size * 1.25, y + size);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrendChart(ctx, options) {
  const {
    width,
    height,
    points,
    lineColor = '#e8a87c',
    fillColor = 'rgba(232, 168, 124, 0.12)',
    yReverse = false,
    yTitle = '',
    empty = false,
    emptyText = '暂无数据'
  } = options;

  ctx.clearRect(0, 0, width, height);
  ctx.setFillStyle('#ffffff');
  ctx.fillRect(0, 0, width, height);

  if (empty || !points || points.length === 0) {
    ctx.setFillStyle('#6b6560');
    ctx.setFontSize(14);
    ctx.setTextAlign('center');
    ctx.fillText(emptyText, width / 2, height / 2);
    ctx.draw();
    return;
  }

  const padding = { left: 42, right: 18, top: 20, bottom: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = points.map((item) => item.value).filter((item) => typeof item === 'number');
  const minValueRaw = Math.min(...values);
  const maxValueRaw = Math.max(...values);
  const span = Math.max(maxValueRaw - minValueRaw, 1);
  const extra = span * 0.15;
  const minValue = yReverse ? Math.floor(Math.max(1, minValueRaw - extra)) : Math.floor(Math.max(0, minValueRaw - extra));
  const maxValue = Math.ceil(maxValueRaw + extra);
  const denominator = Math.max(maxValue - minValue, 1);
  const stepX = points.length === 1 ? 0 : plotWidth / (points.length - 1);

  ctx.setStrokeStyle('#f0ebe4');
  ctx.setLineWidth(1);
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (plotHeight / 4) * index;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    const value = yReverse
      ? Math.round(minValue + ((maxValue - minValue) / 4) * index)
      : Math.round(maxValue - ((maxValue - minValue) / 4) * index);
    ctx.setFillStyle('#9b938d');
    ctx.setFontSize(10);
    ctx.setTextAlign('right');
    ctx.fillText(String(value), padding.left - 6, y + 3);
  }

  ctx.setStrokeStyle('#e8e4de');
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  if (yTitle) {
    ctx.save();
    ctx.translate(12, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.setFillStyle('#6b6560');
    ctx.setFontSize(10);
    ctx.setTextAlign('center');
    ctx.fillText(yTitle, 0, 0);
    ctx.restore();
  }

  const coords = points.map((item, index) => {
    const ratio = yReverse
      ? (item.value - minValue) / denominator
      : (maxValue - item.value) / denominator;
    return {
      x: padding.left + stepX * index,
      y: padding.top + plotHeight * ratio
    };
  });

  ctx.beginPath();
  coords.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.lineTo(coords[coords.length - 1].x, height - padding.bottom);
  ctx.lineTo(coords[0].x, height - padding.bottom);
  ctx.closePath();
  ctx.setFillStyle(fillColor);
  ctx.fill();

  ctx.beginPath();
  coords.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.setStrokeStyle(lineColor);
  ctx.setLineWidth(2);
  ctx.stroke();

  coords.forEach((point) => {
    ctx.beginPath();
    ctx.setFillStyle(lineColor);
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.setStrokeStyle('#ffffff');
    ctx.setLineWidth(2);
    ctx.stroke();
  });

  points.forEach((item, index) => {
    ctx.setFillStyle('#6b6560');
    ctx.setFontSize(10);
    ctx.setTextAlign('center');
    ctx.fillText(
      truncateLabel(item.label, 4),
      padding.left + stepX * index,
      height - padding.bottom + 18
    );
  });

  ctx.draw();
}

function drawRadarChart(ctx, options) {
  const {
    width,
    height,
    labels,
    datasets,
    empty = false,
    emptyText = '选择考试后查看各科得分率分析'
  } = options;

  ctx.clearRect(0, 0, width, height);
  ctx.setFillStyle('#ffffff');
  ctx.fillRect(0, 0, width, height);

  if (empty || !labels || labels.length < 3 || !datasets || datasets.length === 0) {
    ctx.setFillStyle('#6b6560');
    ctx.setFontSize(14);
    ctx.setTextAlign('center');
    ctx.fillText(emptyText, width / 2, height / 2);
    ctx.draw();
    return;
  }

  const legendHeight = 52;
  const centerX = width / 2;
  const centerY = (height - legendHeight) / 2 + 8;
  const radius = Math.min(width, height - legendHeight) * 0.29;
  const axisCount = labels.length;
  const levels = 5;

  for (let level = 1; level <= levels; level += 1) {
    const currentRadius = (radius / levels) * level;
    ctx.beginPath();
    for (let index = 0; index < axisCount; index += 1) {
      const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / axisCount;
      const x = centerX + Math.cos(angle) * currentRadius;
      const y = centerY + Math.sin(angle) * currentRadius;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.setStrokeStyle('#ede7df');
    ctx.setLineWidth(1);
    ctx.stroke();
  }

  for (let index = 0; index < axisCount; index += 1) {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / axisCount;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x, y);
    ctx.setStrokeStyle('#ede7df');
    ctx.stroke();

    ctx.setFillStyle('#6b6560');
    ctx.setFontSize(11);
    ctx.setTextAlign('center');
    ctx.fillText(labels[index], centerX + Math.cos(angle) * (radius + 18), centerY + Math.sin(angle) * (radius + 18));
  }

  for (let level = 1; level <= levels; level += 1) {
    const value = Math.round((100 / levels) * level);
    ctx.setFillStyle('#9b938d');
    ctx.setFontSize(9);
    ctx.setTextAlign('left');
    ctx.fillText(String(value), centerX + 6, centerY - (radius / levels) * level + 3);
  }

  datasets.forEach((dataset) => {
    ctx.beginPath();
    dataset.data.forEach((value, index) => {
      if (value === null || value === undefined) {
        return;
      }
      const ratio = value / 100;
      const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / axisCount;
      const x = centerX + Math.cos(angle) * radius * ratio;
      const y = centerY + Math.sin(angle) * radius * ratio;
      if (index === 0 || dataset.data.slice(0, index).every((item) => item === null || item === undefined)) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.setFillStyle(dataset.fillColor);
    ctx.fill();
    ctx.setStrokeStyle(dataset.borderColor);
    ctx.setLineWidth(2);
    ctx.stroke();

    dataset.data.forEach((value, index) => {
      if (value === null || value === undefined) {
        return;
      }
      const ratio = value / 100;
      const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / axisCount;
      const x = centerX + Math.cos(angle) * radius * ratio;
      const y = centerY + Math.sin(angle) * radius * ratio;
      drawPoint(ctx, dataset.pointStyle || 'circle', x, y, 4, dataset.borderColor);
    });
  });

  let legendX = 16;
  const legendY = height - 24;
  datasets.forEach((dataset) => {
    drawPoint(ctx, dataset.pointStyle || 'circle', legendX + 5, legendY - 4, 4, dataset.borderColor);
    ctx.setFillStyle('#4b4641');
    ctx.setFontSize(10);
    ctx.setTextAlign('left');
    const label = truncateLabel(dataset.label, 8);
    ctx.fillText(label, legendX + 16, legendY);
    legendX += label.length * 12 + 34;
  });

  ctx.draw();
}

module.exports = {
  drawTrendChart,
  drawRadarChart,
  roundRect
};
