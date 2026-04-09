const storage = require('../utils/storage');

function createScoreModule(page) {
  function applyRememberedSubjectFullScore(subjectName) {
    const remembered = storage.getRememberedSubjectFullScore(page._getActiveProfileId(), subjectName);
    if (!remembered) return;

    const currentValue = page.data.scoreForm.fullScore;
    const lastAutoValue = page._scoreFullAutoValue || '100';
    if (currentValue && currentValue !== '100' && currentValue !== lastAutoValue) return;

    page._scoreFullAutoValue = String(remembered);
    page.setData({ 'scoreForm.fullScore': String(remembered) });
  }

  function rememberModalOrigin() {
    page._restoreDetailAfterScoreModal = !!page.data.showDetailPanel;
  }

  function openScoreModal() {
    page._scoreFullAutoValue = '100';
    rememberModalOrigin();
    page.setData({
      editSubjectIndex: null,
      showDetailPanel: false,
      showScoreModal: true,
      scoreForm: { name: '', score: '', fullScore: '100', classRank: '', gradeRank: '', notes: '' }
    });
  }

  function editSubject(e) {
    const index = Number(e.currentTarget.dataset.index);
    const exam = page.data.currentExam;
    if (!exam || !exam.subjects || !exam.subjects[index]) return;

    const sub = exam.subjects[index];
    page._scoreFullAutoValue = '';
    rememberModalOrigin();
    page.setData({
      editSubjectIndex: index,
      showDetailPanel: false,
      showScoreModal: true,
      scoreForm: {
        name: sub.name || '',
        score: sub.score !== undefined ? String(sub.score) : '',
        fullScore: sub.fullScore ? String(sub.fullScore) : '100',
        classRank: sub.classRank ? String(sub.classRank) : '',
        gradeRank: sub.gradeRank ? String(sub.gradeRank) : '',
        notes: sub.notes || ''
      }
    });
  }

  function closeScoreModal() {
    const shouldRestoreDetail = !!page._restoreDetailAfterScoreModal;
    page._restoreDetailAfterScoreModal = false;
    page.setData({
      showScoreModal: false,
      showDetailPanel: shouldRestoreDetail
    });
  }

  function onScoreFormInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    page.setData({ [`scoreForm.${field}`]: value });

    if (field === 'name') {
      applyRememberedSubjectFullScore(value);
    }
    if (field === 'fullScore' && value !== page._scoreFullAutoValue) {
      page._scoreFullAutoValue = '';
    }
  }

  function saveSubject() {
    const form = page.data.scoreForm;
    if (!form.name.trim()) {
      wx.showToast({ title: '请输入科目名称', icon: 'none' });
      return;
    }
    if (form.score === '' || Number.isNaN(Number(form.score))) {
      wx.showToast({ title: '请输入有效成绩', icon: 'none' });
      return;
    }

    const exam = page.data.currentExam;
    if (!exam) return;

    const allExams = storage.getExamsAll();
    const target = allExams.find(ex => ex.id === exam.id);
    if (!target) return;
    if (!target.subjects) target.subjects = [];

    const subjectData = {
      name: form.name.trim(),
      score: Number(form.score),
      fullScore: form.fullScore ? Number(form.fullScore) : 100,
      classRank: form.classRank ? Number(form.classRank) : undefined,
      gradeRank: form.gradeRank ? Number(form.gradeRank) : undefined,
      notes: form.notes.trim()
    };

    storage.rememberSubjectFullScore(page._getActiveProfileId(), subjectData.name, subjectData.fullScore);

    if (page.data.editSubjectIndex !== null && page.data.editSubjectIndex < target.subjects.length) {
      target.subjects[page.data.editSubjectIndex] = subjectData;
    } else {
      target.subjects.push(subjectData);
    }

    storage.saveExamsAll(allExams);

    const shouldRestoreDetail = !!page._restoreDetailAfterScoreModal;
    page._restoreDetailAfterScoreModal = false;
    page.setData({
      showScoreModal: false,
      showDetailPanel: shouldRestoreDetail
    });
    page._saveAndReload();
    wx.showToast({ title: '已保存', icon: 'success' });
  }

  function confirmDeleteSubject() {
    const exam = page.data.currentExam;
    if (!exam || !exam.subjects || exam.subjects.length === 0) return;

    page.setData({
      showConfirmModal: true,
      confirmIcon: '!',
      confirmIconType: 'danger',
      confirmTitle: '删除科目',
      confirmMessage: '请选择要删除的科目。',
      confirmOkText: '',
      confirmOkClass: 'btn-danger',
      confirmShowCancel: false,
      _confirmCallback: null
    });

    const subjectList = exam.subjects.map(s => s.name);
    wx.showActionSheet({
      itemList: subjectList,
      success: (res) => {
        const idx = res.tapIndex;
        const subName = exam.subjects[idx].name;
        page.setData({
          showConfirmModal: true,
          confirmIcon: '!',
          confirmIconType: 'danger',
          confirmTitle: '删除科目',
          confirmMessage: `确定删除“${subName}”吗？`,
          confirmOkText: '删除',
          confirmOkClass: 'btn-danger',
          confirmShowCancel: true,
          _confirmCallback: () => { _doDeleteSubject(idx); }
        });
      },
      fail: () => {
        page.setData({ showConfirmModal: false, _confirmCallback: null });
      }
    });
  }

  function _doDeleteSubject(subjectIndex) {
    const exam = page.data.currentExam;
    if (!exam) return;

    const allExams = storage.getExamsAll();
    const target = allExams.find(ex => ex.id === exam.id);
    if (!target || !target.subjects) return;

    target.subjects.splice(subjectIndex, 1);
    storage.saveExamsAll(allExams);
    page._saveAndReload();
    wx.showToast({ title: '已删除', icon: 'success' });
  }

  return {
    openScoreModal,
    editSubject,
    closeScoreModal,
    onScoreFormInput,
    saveSubject,
    confirmDeleteSubject
  };
}

module.exports = createScoreModule;
