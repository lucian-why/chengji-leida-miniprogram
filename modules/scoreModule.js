const storage = require('../utils/storage');
const validation = require('../utils/validation');

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
    if (form.score === '') {
      wx.showToast({ title: '请输入成绩', icon: 'none' });
      return;
    }
    const scoreFields = validation.parseScoreFields(form.score, form.fullScore, form.name.trim());
    if (!scoreFields.ok) {
      wx.showToast({ title: scoreFields.message, icon: 'none' });
      return;
    }
    const classRank = validation.parseOptionalPositiveInteger(form.classRank, '班级排名');
    if (!classRank.ok) {
      wx.showToast({ title: classRank.message, icon: 'none' });
      return;
    }
    const gradeRank = validation.parseOptionalPositiveInteger(form.gradeRank, '年级排名');
    if (!gradeRank.ok) {
      wx.showToast({ title: gradeRank.message, icon: 'none' });
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
      score: scoreFields.score,
      fullScore: scoreFields.fullScore,
      classRank: classRank.value,
      gradeRank: gradeRank.value,
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
      showDeleteSubjectModal: true,
      deleteSubjectList: exam.subjects.map((s, i) => ({
        name: s.name,
        score: s.score,
        fullScore: s.fullScore || 100,
        index: i,
        selected: false
      })),
      deleteSubjectSelected: -1
    });
  }

  function toggleDeleteSubject(e) {
    const idx = e.currentTarget.dataset.index;
    const list = page.data.deleteSubjectList;
    const current = page.data.deleteSubjectSelected;

    list.forEach((item, i) => {
      item.selected = (i === idx && current !== idx);
    });

    page.setData({
      deleteSubjectList: list,
      deleteSubjectSelected: current === idx ? -1 : idx
    });
  }

  function doDeleteSelectedSubject() {
    const idx = page.data.deleteSubjectSelected;
    if (idx < 0) return;

    const subName = page.data.deleteSubjectList[idx].name;
    page.setData({
      showDeleteSubjectModal: false,
      showConfirmModal: true,
      confirmIcon: '!',
      confirmIconType: 'danger',
      confirmTitle: '删除科目',
      confirmMessage: `确定删除"${subName}"吗？`,
      confirmOkText: '删除',
      confirmOkClass: 'btn-danger',
      confirmShowCancel: true,
      _confirmCallback: () => { _doDeleteSubject(idx); }
    });
  }

  function closeDeleteSubjectModal() {
    page.setData({
      showDeleteSubjectModal: false,
      deleteSubjectSelected: -1
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
    confirmDeleteSubject,
    toggleDeleteSubject,
    doDeleteSelectedSubject,
    closeDeleteSubjectModal
  };
}

module.exports = createScoreModule;
