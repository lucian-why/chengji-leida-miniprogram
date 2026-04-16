/**
 * 分享报告模块
 * 负责：考试报告/档案报告生成、保存、分享
 * 对应原代码 L1133-1256 区段
 */
const report = require('../utils/report');

function createReportModule(page) {

  function openShareExamReport() {
    const exam = page.data.currentExam;
    if (!exam) return;
    const profile = page.data.profiles[page.data.activeProfileIndex];
    const payload = { exam, profileName: profile ? profile.name : '' };
    const width = 375;
    // 先计算高度，再打开弹窗，避免高度跳变
    const drawHeight = report.drawExamReport(null, { ...payload, width });
    page.setData({
      reportType: 'exam',
      showReportModal: true,
      reportLoading: true,
      reportImage: '',
      reportCanvasHeight: drawHeight,
      _reportPayload: payload
    });
    setTimeout(() => _drawCanvas(), 300);
  }

  function openShareProfileReport(e) {
    const index = e.currentTarget.dataset.index;
    const profile = page.data.profiles[index];
    if (!profile) return;
    const exams = require('../utils/storage').getExams(profile.id, true);
    const payload = { profile, exams };
    const width = 375;
    // 先计算高度，再打开弹窗，避免高度跳变
    const drawHeight = report.drawProfileReport(null, { ...payload, width });
    page.setData({
      reportType: 'profile',
      showReportModal: true,
      reportLoading: true,
      reportImage: '',
      reportCanvasHeight: drawHeight,
      _reportPayload: payload
    });
    setTimeout(() => _drawCanvas(), 300);
  }

  function _drawCanvas() {
    const payload = page.data._reportPayload;
    const width = 375;
    const drawHeight = page.data.reportCanvasHeight;

    const ctx = wx.createCanvasContext('reportCanvas', page);

    if (page.data.reportType === 'exam') {
      report.drawExamReport(ctx, { ...payload, width });
    } else {
      report.drawProfileReport(ctx, { ...payload, width });
    }

    ctx.draw(false, () => {
      setTimeout(() => {
        wx.canvasToTempFilePath({
          canvasId: 'reportCanvas', x: 0, y: 0, width, height: drawHeight,
          destWidth: width * 2, destHeight: drawHeight * 2, fileType: 'png',
          success: (res) => { page.setData({ reportLoading: false, reportImage: res.tempFilePath }); },
          fail: (err) => { console.error('报告生成失败', err); page.setData({ reportLoading: false }); wx.showToast({ title: '报告生成失败', icon: 'none' }); }
        }, page);
      }, 500);
    });
  }

  function closeReportModal() {
    page.setData({ showReportModal: false, reportImage: '' });
  }

  function saveReport() {
    if (!page.data.reportImage) return;
    wx.saveImageToPhotosAlbum({
      filePath: page.data.reportImage,
      success: () => { wx.showToast({ title: '已保存到相册', icon: 'success' }); },
      fail: (err) => {
        if (err.errMsg.includes('auth deny') || err.errMsg.includes('authorize')) {
          wx.showModal({ title: '需要相册权限', content: '请前往设置页开启「保存到相册」权限', confirmText: '去设置', success: (res) => { if (res.confirm) { wx.openSetting(); } } });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  }

  function shareReport() {
    if (!page.data.reportImage) return;
    wx.previewImage({ current: page.data.reportImage, urls: [page.data.reportImage] });
  }

  return {
    openShareExamReport,
    openShareProfileReport,
    closeReportModal,
    saveReport,
    shareReport
  };
}

module.exports = createReportModule;
