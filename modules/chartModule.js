/**
 * 图表分析模块
 * 负责：趋势图、雷达图、图表放大、对比选择
 * 对应原代码 L632-1001 区段（最大模块，~370行）
 */
var storage = require('../utils/storage');
var fmt = require('../utils/format');
var chart = require('../utils/chart');

function createChartModule(page) {

  /** 切换分析模式（分数/排名/雷达） */
  function switchAnalysisMode(e) {
    var mode = e.currentTarget.dataset.mode;
    page.setData({ analysisMode: mode });
    setTimeout(function() { _drawChart(); }, 100);
  }

  /** 选择图表筛选科目 */
  function selectChartSubject(e) {
    var subject = e.currentTarget.dataset.subject;
    page.setData({ selectedChartSubject: subject });
    setTimeout(function() { _drawChart(); }, 100);
  }

  /** 切换排名类型（班级/年级） */
  function switchRankType(e) {
    var type = e.currentTarget.dataset.type;
    page.setData({ rankType: type });
    storage.saveTrendMode({ mode: page.data.analysisMode, rankType: type });
    setTimeout(function() { _drawChart(); }, 100);
  }

  /** 刷新分析数据（雷达图考试列表等） */
  function _refreshAnalysis() {
    var allExams = storage.getExams(page._getActiveProfileId(), true)
      .sort(fmt.compareExamDateDesc);

    var currentExamId = page.data.currentExamId || '';
    var radarExams = allExams.map(function(ex) {
      return {
        id: ex.id,
        name: ex.name,
        totalScore: fmt.getDisplayTotalScore(ex),
        isCurrent: ex.id === currentExamId,
        selected: false
      };
    });

    page.setData({ radarExams: radarExams });

    var modeSettings = storage.getTrendMode();
    if (modeSettings.rankType) {
      page.setData({ rankType: modeSettings.rankType });
    }
  }

  /** 绘制图表入口（根据 mode 分发） */
  function _drawChart() {
    if (page.data.currentTab !== 'trend') return;
    if (page.data.analysisMode === 'radar') {
      _drawRadarChart();
    } else {
      _drawTrendChart();
    }
  }

  /** ====== 趋势图绘制 ====== */
  function _drawTrendChart() {
    var query = wx.createSelectorQuery();
    query.select('#trendChart').boundingClientRect();
    query.exec(function(res) {
      if (!res[0]) return;
      var width = res[0].width;
      var height = res[0].height;
      var ctx = wx.createCanvasContext('trendChart', page);

      var exams = storage.getExams(page._getActiveProfileId(), true)
        .sort(fmt.compareExamDateAsc);

      var points = [];
      var yReverse = false;
      var yTitle = '';

      if (page.data.analysisMode === 'score') {
        yTitle = '\u5206\u6570';
        if (page.data.selectedChartSubject) {
          points = exams.map(function(ex) {
            var sub = (ex.subjects || []).find(function(s) { return s.name === page.data.selectedChartSubject; });
            return { label: ex.name, value: sub ? sub.score : null };
          }).filter(function(p) { return p.value !== null; });
        } else {
          points = exams.map(function(ex) { return { label: ex.name, value: fmt.getDisplayTotalScore(ex) }; });
        }
      } else {
        yReverse = true;
        yTitle = page.data.rankType === 'class' ? '\u73ED\u7EA7\u6392\u540D' : '\u5E74\u7EA7\u6392\u540D';
        var rankKey = page.data.rankType === 'class' ? 'totalClassRank' : 'totalGradeRank';

        if (page.data.selectedChartSubject) {
          points = exams.map(function(ex) {
            var sub = (ex.subjects || []).find(function(s) { return s.name === page.data.selectedChartSubject; });
            var subRankKey = page.data.rankType === 'class' ? 'classRank' : 'gradeRank';
            return { label: ex.name, value: sub ? sub[subRankKey] : null };
          }).filter(function(p) { return p.value !== null; });
        } else {
          points = exams.map(function(ex) { return { label: ex.name, value: ex[rankKey] }; })
            .filter(function(p) { return p.value !== null && p.value !== undefined; });
        }
      }

      var isEmpty = points.length === 0;
      page.setData({ trendEmpty: isEmpty });

      chart.drawTrendChart(ctx, {
        width: width, height: height, points: points,
        lineColor: page.data.analysisMode === 'rank' ? '#9b8dc4' : '#e8a87c',
        fillColor: page.data.analysisMode === 'rank' ? 'rgba(155, 141, 196, 0.12)' : 'rgba(232, 168, 124, 0.12)',
        yReverse: yReverse, yTitle: yTitle,
        empty: isEmpty,
        emptyText: page.data.analysisMode === 'rank' ? '\u6682\u65E0\u6392\u540D\u6570\u636E' : '\u6682\u65E0\u6210\u7EE9\u6570\u636E'
      });
    });
  }

  /** ====== 雷达图 - 切换当前展示考试 ====== */
  function switchCurrentExam() {
    var allExams = page.data.exams.filter(function(e) { return !e.excluded; });
    if (allExams.length <= 1) return;

    var currentId = page.data.currentExamId;
    var currentIndex = -1;
    for (var i = 0; i < allExams.length; i++) {
      if (allExams[i].id === currentId) { currentIndex = i; break; }
    }
    if (currentIndex === -1) currentIndex = 0;

    var nextIndex = (currentIndex + 1) % allExams.length;
    var nextExam = allExams[nextIndex];

    page.setData({ currentExamId: nextExam.id });
    page._refreshCurrentExam();
    page._refreshAnalysis();
    setTimeout(function() { _drawChart(); }, 100);
  }

  /** ====== 雷达图 - 点击考试 chip ====== */
  function onRadarExamTap(e) {
    var id = e.currentTarget.dataset.id;
    var radarExams = page.data.radarExams;

    var target = null;
    for (var i = 0; i < radarExams.length; i++) {
      if (radarExams[i].id === id) { target = radarExams[i]; break; }
    }
    if (!target) return;

    if (target.isCurrent) {
      // 点击当前考试
      var hasCompare = false;
      for (var j = 0; j < radarExams.length; j++) {
        if (radarExams[j].selected) { hasCompare = true; break; }
      }
      if (hasCompare) {
        // 有对比考试 -> 切换到下一场
        switchCurrentExam();
      } else {
        // 无对比考试 -> 取消选中，显示空状态
        page.setData({ currentExamId: '', currentExam: null });
        page._refreshAnalysis();
        setTimeout(function() { _drawChart(); }, 100);
      }
    } else {
      // 点击非当前考试
      var hasAnyCurrent = false;
      for (var k = 0; k < radarExams.length; k++) {
        if (radarExams[k].isCurrent) { hasAnyCurrent = true; break; }
      }

      if (!hasAnyCurrent) {
        // 当前无展示考试 -> 直接设为展示考试
        page.setData({ currentExamId: target.id });
        page._refreshCurrentExam();
        page._refreshAnalysis();
        setTimeout(function() { _drawChart(); }, 100);
      } else {
        // 有展示考试 -> 切换对比选中状态
        var selectedCount = 0;
        for (var m = 0; m < radarExams.length; m++) {
          if (radarExams[m].selected) selectedCount++;
        }
        if (!target.selected && selectedCount >= 2) return;

        var updated = radarExams.map(function(ex) {
          if (ex.id === id) return Object.assign({}, ex, { selected: !ex.selected });
          return ex;
        });
        page.setData({ radarExams: updated });
        setTimeout(function() { _drawRadarChart(); }, 100);
      }
    }
  }

  /** ====== 雷达图绘制 ====== */
  function _drawRadarChart() {
    var query = wx.createSelectorQuery();
    query.select('#radarChart').boundingClientRect();
    query.exec(function(res) {
      if (!res[0]) return;
      var width = res[0].width;
      var height = res[0].height;
      var ctx = wx.createCanvasContext('radarChart', page);

      var currentExam = page.data.currentExam;

      // 从 radarExams 获取选中的对比考试 id
      var compareIds = [];
      var radarExams = page.data.radarExams || [];
      for (var i = 0; i < radarExams.length; i++) {
        if (radarExams[i].selected) compareIds.push(radarExams[i].id);
      }

      // 从完整考试列表获取对比考试数据
      var compareExams = page.data.exams.filter(function(ex) {
        return compareIds.indexOf(ex.id) !== -1;
      });

      var allCompareExams = [currentExam].concat(compareExams).filter(function(ex) { return ex && ex.id; });

      if (allCompareExams.length === 0 || !currentExam) {
        page.setData({ radarEmpty: true, radarEmptyText: '\u9009\u62E9\u8003\u8BD5\u540E\u67E5\u770B\u5404\u79D1\u5F97\u5206\u7387\u5206\u6790', radarBest: null, radarWorst: null });
        chart.drawRadarChart(ctx, { width: width, height: height, empty: true });
        return;
      }

      var labelSet = {};
      allCompareExams.forEach(function(ex) {
        (ex.subjects || []).forEach(function(s) { if (s.name) labelSet[s.name] = true; });
      });
      var labels = Object.keys(labelSet);

      if (labels.length < 3) {
        page.setData({ radarEmpty: true, radarEmptyText: '\u81F3\u5C11\u9700\u89813\u4E2A\u79D1\u76EE\u624D\u80FD\u751F\u6210\u96F7\u8FBE\u56FE', radarBest: null, radarWorst: null });
        chart.drawRadarChart(ctx, { width: width, height: height, empty: true, emptyText: '\u81F3\u5C11\u9700\u89813\u4E2A\u79D1\u76EE' });
        return;
      }

      page.setData({ radarEmpty: false });

      var colorSets = [
        { borderColor: '#e8a87c', fillColor: 'rgba(232, 168, 124, 0.2)', pointStyle: 'circle', label: '\u5F53\u524D\u8003\u8BD5' },
        { borderColor: '#7ca9c9', fillColor: 'rgba(124, 169, 201, 0.15)', pointStyle: 'rect', label: '\u5BF9\u6BD41' },
        { borderColor: '#9b8dc4', fillColor: 'rgba(155, 141, 196, 0.15)', pointStyle: 'triangle', label: '\u5BF9\u6BD42' }
      ];

      var datasets = allCompareExams.map(function(ex, idx) {
        var data = labels.map(function(label) {
          var sub = null;
          var subjects = ex.subjects || [];
          for (var j = 0; j < subjects.length; j++) {
            if (subjects[j].name === label) { sub = subjects[j]; break; }
          }
          if (!sub || !sub.fullScore) return null;
          return Number(fmt.toPercent(sub.score, sub.fullScore, 1)) || 0;
        });
        return Object.assign({}, colorSets[idx], { label: ex.name, data: data });
      });

      chart.drawRadarChart(ctx, { width: width, height: height, labels: labels, datasets: datasets });

      // 计算最强/最弱科目
      var subjects = (currentExam.subjects || []).filter(function(s) { return s.fullScore > 0; });
      if (subjects.length >= 3) {
        var sorted = subjects.map(function(s) {
          return { name: s.name, score: s.score, fullScore: s.fullScore, rate: s.score / s.fullScore };
        }).sort(function(a, b) { return b.rate - a.rate; });
        page.setData({
          radarBest: { name: sorted[0].name, score: sorted[0].score, fullScore: sorted[0].fullScore, rate: Math.round(sorted[0].rate * 100) },
          radarWorst: { name: sorted[sorted.length - 1].name, score: sorted[sorted.length - 1].score, fullScore: sorted[sorted.length - 1].fullScore, rate: Math.round(sorted[sorted.length - 1].rate * 100) }
        });
      } else {
        page.setData({ radarBest: null, radarWorst: null });
      }
    });
  }

  /** ====== 图表放大 ====== */
  function openChartZoom(e) {
    var type = e.currentTarget.dataset.type;
    var title = type === 'radar'
      ? '\uD83C\uDFAF \u79D1\u76EE\u5BF9\u6BD4'
      : (page.data.analysisMode === 'rank' ? '\uD83C\uDFC5 \u6392\u540D\u8D8B\u52BF' : '\uD83D\uDCCA \u5206\u6570\u8D8B\u52BF');

    page.setData({
      showChartZoom: true,
      chartZoomType: type,
      chartZoomTitle: title,
      zoomSelectedSubject: page.data.selectedChartSubject || '',
      zoomRankType: page.data.rankType
    });

    setTimeout(function() {
      if (type === 'radar') { _drawZoomRadarChart(); }
      else { _drawZoomTrendChart(); }
    }, 400);
  }

  function closeChartZoom() {
    page.setData({ showChartZoom: false });
  }

  function zoomSelectSubject(e) {
    var subject = e.currentTarget.dataset.subject;
    page.setData({ zoomSelectedSubject: subject });
    setTimeout(function() { _drawZoomTrendChart(); }, 100);
  }

  function zoomSwitchRankType(e) {
    var type = e.currentTarget.dataset.type;
    page.setData({ zoomRankType: type });
    setTimeout(function() { _drawZoomTrendChart(); }, 100);
  }

  /** 放大版趋势图 */
  function _drawZoomTrendChart() {
    var query = wx.createSelectorQuery();
    query.select('#zoomTrendChart').boundingClientRect();
    query.exec(function(res) {
      if (!res[0]) return;
      var width = res[0].width;
      var height = res[0].height;
      var ctx = wx.createCanvasContext('zoomTrendChart', page);

      var exams = storage.getExams(page._getActiveProfileId(), true)
        .sort(fmt.compareExamDateAsc);
      var selectedSubject = page.data.zoomSelectedSubject;
      var isRank = page.data.analysisMode === 'rank';
      var rankType = page.data.zoomRankType;

      var points = [];
      var yReverse = false;
      var yTitle = '';

      if (isRank) {
        yReverse = true;
        yTitle = rankType === 'class' ? '\u73ED\u7EA7\u6392\u540D' : '\u5E74\u7EA7\u6392\u540D';
        var rankKey = rankType === 'class' ? 'totalClassRank' : 'totalGradeRank';
        var subRankKey = rankType === 'class' ? 'classRank' : 'gradeRank';

        if (selectedSubject) {
          points = exams.map(function(ex) {
            var sub = (ex.subjects || []).find(function(s) { return s.name === selectedSubject; });
            return { label: ex.name, value: sub ? sub[subRankKey] : null };
          }).filter(function(p) { return p.value !== null; });
        } else {
          points = exams.map(function(ex) { return { label: ex.name, value: ex[rankKey] }; })
            .filter(function(p) { return p.value !== null && p.value !== undefined; });
        }
      } else {
        yTitle = '\u5206\u6570';
        if (selectedSubject) {
          points = exams.map(function(ex) {
            var sub = (ex.subjects || []).find(function(s) { return s.name === selectedSubject; });
            return { label: ex.name, value: sub ? sub.score : null };
          }).filter(function(p) { return p.value !== null; });
        } else {
          points = exams.map(function(ex) { return { label: ex.name, value: fmt.getDisplayTotalScore(ex) }; });
        }
      }

      chart.drawTrendChart(ctx, {
        width: width, height: height, points: points,
        lineColor: isRank ? '#9b8dc4' : '#e8a87c',
        fillColor: isRank ? 'rgba(155, 141, 196, 0.12)' : 'rgba(232, 168, 124, 0.12)',
        yReverse: yReverse, yTitle: yTitle,
        empty: points.length === 0,
        emptyText: isRank ? '\u6682\u65E0\u6392\u540D\u6570\u636E' : '\u6682\u65E0\u6210\u7EE9\u6570\u636E'
      });
    });
  }

  /** 放大版雷达图 */
  function _drawZoomRadarChart() {
    var query = wx.createSelectorQuery();
    query.select('#zoomRadarChart').boundingClientRect();
    query.exec(function(res) {
      if (!res[0]) return;
      var width = res[0].width;
      var height = res[0].height;
      var ctx = wx.createCanvasContext('zoomRadarChart', page);

      var currentExam = page.data.currentExam;

      // 从 radarExams 获取选中的对比考试 id
      var compareIds = [];
      var radarExams = page.data.radarExams || [];
      for (var i = 0; i < radarExams.length; i++) {
        if (radarExams[i].selected) compareIds.push(radarExams[i].id);
      }
      var compareExams = page.data.exams.filter(function(ex) {
        return compareIds.indexOf(ex.id) !== -1;
      });

      var allCompareExams = [currentExam].concat(compareExams).filter(function(ex) { return ex && ex.id; });

      if (allCompareExams.length === 0 || !currentExam) {
        chart.drawRadarChart(ctx, { width: width, height: height, empty: true });
        return;
      }

      var labelSet = {};
      allCompareExams.forEach(function(ex) {
        (ex.subjects || []).forEach(function(s) { if (s.name) labelSet[s.name] = true; });
      });
      var labels = Object.keys(labelSet);

      if (labels.length < 3) {
        chart.drawRadarChart(ctx, { width: width, height: height, empty: true, emptyText: '\u81F3\u5C11\u9700\u89813\u4E2A\u79D1\u76EE' });
        return;
      }

      var colorSets = [
        { borderColor: '#e8a87c', fillColor: 'rgba(232, 168, 124, 0.2)', pointStyle: 'circle', label: '\u5F53\u524D\u8003\u8BD5' },
        { borderColor: '#7ca9c9', fillColor: 'rgba(124, 169, 201, 0.15)', pointStyle: 'rect', label: '\u5BF9\u6BD41' },
        { borderColor: '#9b8dc4', fillColor: 'rgba(155, 141, 196, 0.15)', pointStyle: 'triangle', label: '\u5BF9\u6BD42' }
      ];

      var datasets = allCompareExams.map(function(ex, idx) {
        var data = labels.map(function(label) {
          var sub = null;
          var subjects = ex.subjects || [];
          for (var j = 0; j < subjects.length; j++) {
            if (subjects[j].name === label) { sub = subjects[j]; break; }
          }
          if (!sub || !sub.fullScore) return null;
          return Number(fmt.toPercent(sub.score, sub.fullScore, 1)) || 0;
        });
        return Object.assign({}, colorSets[idx], { label: ex.name, data: data });
      });

      chart.drawRadarChart(ctx, { width: width, height: height, labels: labels, datasets: datasets });
    });
  }

  return {
    switchAnalysisMode: switchAnalysisMode,
    selectChartSubject: selectChartSubject,
    switchRankType: switchRankType,
    _refreshAnalysis: _refreshAnalysis,
    _drawChart: _drawChart,
    switchCurrentExam: switchCurrentExam,
    onRadarExamTap: onRadarExamTap,
    openChartZoom: openChartZoom,
    closeChartZoom: closeChartZoom,
    zoomSelectSubject: zoomSelectSubject,
    zoomSwitchRankType: zoomSwitchRankType
  };
}

module.exports = createChartModule;
