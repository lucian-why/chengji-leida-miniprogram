const storage = require('../utils/storage');
const validation = require('../utils/validation');

function createExamModule(page) {
  function addDays(dateString, days) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  function selectExam(e) {
    const id = e.currentTarget.dataset.id;
    if (page.data.currentExamId === id) {
      page.setData({ currentExamId: '', showDetailPanel: false, isEditingTotalScore: false, editingTotalScore: '' });
      page._refreshCurrentExam();
      return;
    }
    page.setData({ currentExamId: id, showDetailPanel: true, isEditingTotalScore: false, editingTotalScore: '' });
    page._refreshCurrentExam();
    page._refreshAnalysis();
  }

  function closeDetailPanel() {
    page.setData({ showDetailPanel: false, currentExamId: '', currentExam: null, showScoreView: false, isEditingTotalScore: false, editingTotalScore: '' });
  }

  function _refreshCurrentExam() {
    const id = page.data.currentExamId;
    if (!id) {
      page.setData({ currentExam: null, showScoreView: false });
      return;
    }
    const exam = page.data.exams.find(e => e.id === id) || null;
    page.setData({
      currentExam: exam,
      showScoreView: page.data.showScoreView || false,
      showDetailPanel: page.data.showDetailPanel || false
    });
  }

  function startEditTotalScore() {
    const exam = page.data.currentExam;
    if (!exam) return;
    page.setData({
      isEditingTotalScore: true,
      editingTotalScore: String(exam.totalScore || 0)
    });
  }

  function onTotalScoreInput(e) {
    page.setData({ editingTotalScore: e.detail.value });
  }

  function prepareCancelInlineTotalScore() {
    page._skipInlineTotalScoreSave = true;
  }

  function cancelInlineTotalScore() {
    page._skipInlineTotalScoreSave = false;
    page.setData({ isEditingTotalScore: false, editingTotalScore: '' });
  }

  function saveInlineTotalScore() {
    if (!page.data.isEditingTotalScore) return;
    if (page._skipInlineTotalScoreSave) {
      page._skipInlineTotalScoreSave = false;
      return;
    }

    const exam = page.data.currentExam;
    if (!exam) {
      cancelInlineTotalScore();
      return;
    }

    const rawValue = String(page.data.editingTotalScore || '').trim();
    const allExams = storage.getExamsAll();
    const index = allExams.findIndex(item => item.id === exam.id);
    if (index === -1) {
      cancelInlineTotalScore();
      return;
    }

    if (!rawValue) {
      delete allExams[index].manualTotalScore;
    } else {
      const parsedTotal = validation.parseNonNegativeNumber(rawValue, '总分');
      if (!parsedTotal.ok) {
        wx.showToast({ title: parsedTotal.message, icon: 'none' });
        return;
      }
      allExams[index].manualTotalScore = parsedTotal.value;
    }

    page.setData({ isEditingTotalScore: false, editingTotalScore: '' });
    storage.saveExamsAll(allExams);
    page._saveAndReload();
    wx.showToast({ title: '总分已更新', icon: 'success' });
  }

  function confirmRestoreAutoTotalScore() {
    const exam = page.data.currentExam;
    if (!exam || !exam.totalScoreMismatch) return;

    page.setData({
      showConfirmModal: true,
      confirmIcon: '!',
      confirmIconType: 'danger',
      confirmTitle: '恢复自动总分',
      confirmMessage: '确定按各科成绩重新计算总分吗？当前手动修改的总分将被清除。',
      confirmOkText: '恢复',
      confirmOkClass: 'btn-danger',
      confirmShowCancel: true,
      _confirmCallback: () => {
        const allExams = storage.getExamsAll();
        const index = allExams.findIndex(item => item.id === exam.id);
        if (index === -1) return;
        delete allExams[index].manualTotalScore;
        storage.saveExamsAll(allExams);
        page.setData({ isEditingTotalScore: false, editingTotalScore: '' });
        page._saveAndReload();
        wx.showToast({ title: '已恢复自动总分', icon: 'success' });
      }
    });
  }

  function openExamModal(e) {
    const id = e && e.currentTarget ? e.currentTarget.dataset.id : '';
    page._examEndDateManual = false;

    if (id) {
      const exam = page.data.exams.find(item => item.id === id);
      if (!exam) return;
      page._examEndDateManual = true;
      page.setData({
        editExamId: id,
        showExamModal: true,
        examForm: {
          name: exam.name || '',
          startDate: exam.startDate || '',
          endDate: exam.endDate || '',
          notes: exam.notes || '',
          totalClassRank: exam.totalClassRank ? String(exam.totalClassRank) : '',
          totalGradeRank: exam.totalGradeRank ? String(exam.totalGradeRank) : '',
          classTotal: exam.classTotal ? String(exam.classTotal) : '',
          gradeTotal: exam.gradeTotal ? String(exam.gradeTotal) : ''
        }
      });
      return;
    }

    const rememberedDefaults = storage.getRememberedExamDefaults(page._getActiveProfileId());
    const today = new Date().toISOString().split('T')[0];
    page.setData({
      editExamId: '',
      showExamModal: true,
      examForm: {
        name: '',
        startDate: today,
        endDate: addDays(today, 1),
        notes: '',
        totalClassRank: '',
        totalGradeRank: '',
        classTotal: rememberedDefaults.classTotal ? String(rememberedDefaults.classTotal) : '',
        gradeTotal: rememberedDefaults.gradeTotal ? String(rememberedDefaults.gradeTotal) : ''
      }
    });
  }

  function closeExamModal() {
    page.setData({ showExamModal: false });
  }

  function onExamFormInput(e) {
    const field = e.currentTarget.dataset.field;
    page.setData({ [`examForm.${field}`]: e.detail.value });
  }

  function onExamDatePick(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;

    if (field === 'endDate') {
      page._examEndDateManual = true;
      page.setData({ 'examForm.endDate': value });
      return;
    }

    if (field === 'startDate') {
      const updates = { 'examForm.startDate': value };
      if (!page.data.editExamId && !page._examEndDateManual) {
        updates['examForm.endDate'] = addDays(value, 1);
      }
      page.setData(updates);
      return;
    }

    page.setData({ [`examForm.${field}`]: value });
  }

  function saveExam() {
    const form = page.data.examForm;
    if (!form.name.trim()) {
      wx.showToast({ title: '请输入考试名称', icon: 'none' });
      return;
    }

    if (form.startDate && form.endDate && new Date(form.endDate).getTime() < new Date(form.startDate).getTime()) {
      wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' });
      return;
    }

    const classRank = validation.parseRankPair(form.totalClassRank, form.classTotal, '班级排名', '班级总人数');
    if (!classRank.ok) {
      wx.showToast({ title: classRank.message, icon: 'none' });
      return;
    }
    const gradeRank = validation.parseRankPair(form.totalGradeRank, form.gradeTotal, '年级排名', '年级总人数');
    if (!gradeRank.ok) {
      wx.showToast({ title: gradeRank.message, icon: 'none' });
      return;
    }

    const profileId = page._getActiveProfileId();
    storage.rememberExamDefaults(profileId, {
      classTotal: classRank.total || null,
      gradeTotal: gradeRank.total || null
    });

    if (page.data.editExamId) {
      const allExams = storage.getExamsAll();
      const idx = allExams.findIndex(e => e.id === page.data.editExamId);
      if (idx !== -1) {
        allExams[idx] = {
          ...allExams[idx],
          name: form.name.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          notes: form.notes.trim(),
          totalClassRank: classRank.rank,
          totalGradeRank: gradeRank.rank,
          classTotal: classRank.total,
          gradeTotal: gradeRank.total
        };
        storage.saveExamsAll(allExams);
      }
    } else {
      const newExam = {
        id: 'exam_' + Date.now(),
        profileId,
        name: form.name.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        notes: form.notes.trim(),
        totalClassRank: classRank.rank,
        totalGradeRank: gradeRank.rank,
        classTotal: classRank.total,
        gradeTotal: gradeRank.total,
        subjects: [],
        createdAt: new Date().toISOString()
      };
      const allExams = storage.getExamsAll();
      allExams.push(newExam);
      storage.saveExamsAll(allExams);
      page.setData({ currentExamId: newExam.id });
    }

    page.setData({ showExamModal: false });
    page._saveAndReload();
    wx.showToast({ title: page.data.editExamId ? '已更新' : '已创建', icon: 'success' });
  }

  function deleteExam(e) {
    const id = e.currentTarget.dataset.id;
    const exam = page.data.exams.find(ex => ex.id === id);
    if (!exam) return;

    page.setData({
      showConfirmModal: true,
      confirmIcon: '⚠️',
      confirmIconType: 'danger',
      confirmTitle: '删除考试',
      confirmMessage: `确定要删除“${exam.name}”吗？\n此操作不可撤销。`,
      confirmOkText: '删除',
      confirmOkClass: 'btn-danger',
      confirmShowCancel: true,
      _confirmCallback: () => {
        const allExams = storage.getExamsAll().filter(ex => ex.id !== id);
        storage.saveExamsAll(allExams);
        page.setData({ currentExamId: '', currentExam: null, showDetailPanel: false });
        page._saveAndReload();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  }

  function toggleExclude(e) {
    const id = e.currentTarget.dataset.id;
    const allExams = storage.getExamsAll();
    const exam = allExams.find(ex => ex.id === id);
    if (!exam) return;
    exam.excluded = !exam.excluded;
    storage.saveExamsAll(allExams);
    page._saveAndReload();
    wx.showToast({ title: exam.excluded ? '已排除' : '已恢复', icon: 'none' });
  }

  return {
    selectExam,
    closeDetailPanel,
    _refreshCurrentExam,
    startEditTotalScore,
    onTotalScoreInput,
    prepareCancelInlineTotalScore,
    cancelInlineTotalScore,
    saveInlineTotalScore,
    confirmRestoreAutoTotalScore,
    openExamModal,
    closeExamModal,
    onExamFormInput,
    onExamDatePick,
    saveExam,
    deleteExam,
    toggleExclude
  };
}

module.exports = createExamModule;
