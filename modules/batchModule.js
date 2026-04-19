const storage = require('../utils/storage');
const validation = require('../utils/validation');

function createBatchModule(page) {
  function noop() {}

  function getCurrentExamSnapshot() {
    const currentExamId = page.data.currentExamId;
    if (!currentExamId) return null;
    return storage.getExamsAll().find(exam => exam.id === currentExamId) || null;
  }

  function openBatchModal() {
    const exam = getCurrentExamSnapshot();
    if (!exam) return;

    const subjects = (exam.subjects || []).map(s => ({
      name: s.name,
      score: s.score !== undefined ? String(s.score) : '',
      classRank: s.classRank ? String(s.classRank) : '',
      gradeRank: s.gradeRank ? String(s.gradeRank) : '',
      fullScore: s.fullScore || 100
    }));

    if (subjects.length === 0) {
      subjects.push({ name: '', score: '', classRank: '', gradeRank: '', fullScore: 100 });
    }

    page.setData({
      currentExam: exam,
      showBatchModal: true,
      batchList: subjects,
      newBatchSubject: ''
    });
  }

  function closeBatchModal() {
    page.setData({ showBatchModal: false, batchList: [], newBatchSubject: '' });
  }

  function onBatchInput(e) {
    const { index, field } = e.currentTarget.dataset;
    page.setData({ [`batchList[${index}].${field}`]: e.detail.value });
  }

  function addBatchSubject() {
    const name = page.data.newBatchSubject.trim();
    if (!name) {
      wx.showToast({ title: '请输入科目名', icon: 'none' });
      return;
    }

    const allExams = storage.getExamsAll().filter(ex => ex.id !== page.data.currentExamId);
    let fullScore = storage.getRememberedSubjectFullScore(page._getActiveProfileId(), name) || 100;
    for (const exam of allExams) {
      const found = (exam.subjects || []).find(s => s.name === name);
      if (found && found.fullScore) {
        fullScore = found.fullScore;
        break;
      }
    }

    const list = page.data.batchList.concat([{ name, score: '', classRank: '', gradeRank: '', fullScore }]);
    page.setData({ batchList: list, newBatchSubject: '' });
  }

  function onNewBatchInput(e) {
    page.setData({ newBatchSubject: e.detail.value });
  }

  function removeBatchSubject(e) {
    const index = e.currentTarget.dataset.index;
    const list = page.data.batchList.slice();
    if (list.length <= 1) {
      wx.showToast({ title: '至少保留一个科目', icon: 'none' });
      return;
    }
    list.splice(index, 1);
    page.setData({ batchList: list });
  }

  function saveBatch() {
    const list = page.data.batchList;
    const validSubjects = list.filter(s => s.name.trim());

    if (validSubjects.length === 0) {
      wx.showToast({ title: '至少填写一个科目', icon: 'none' });
      return;
    }

    const parsedSubjects = [];
    for (const s of validSubjects) {
      const name = s.name.trim();
      if (s.score === '') {
        wx.showToast({ title: `“${name}”请输入成绩`, icon: 'none' });
        return;
      }
      const scoreFields = validation.parseScoreFields(s.score, s.fullScore, `“${name}”`);
      if (!scoreFields.ok) {
        wx.showToast({ title: scoreFields.message, icon: 'none' });
        return;
      }
      const classRank = validation.parseOptionalPositiveInteger(s.classRank, `“${name}”班级排名`);
      if (!classRank.ok) {
        wx.showToast({ title: classRank.message, icon: 'none' });
        return;
      }
      const gradeRank = validation.parseOptionalPositiveInteger(s.gradeRank, `“${name}”年级排名`);
      if (!gradeRank.ok) {
        wx.showToast({ title: gradeRank.message, icon: 'none' });
        return;
      }
      parsedSubjects.push({
        name,
        score: scoreFields.score,
        fullScore: scoreFields.fullScore,
        classRank: classRank.value,
        gradeRank: gradeRank.value
      });
    }

    const target = getCurrentExamSnapshot();
    if (!target) return;

    const allExams = storage.getExamsAll();
    const currentExamIndex = allExams.findIndex(ex => ex.id === target.id);
    if (currentExamIndex === -1) return;

    allExams[currentExamIndex].subjects = parsedSubjects;

    storage.saveExamsAll(allExams);
    page.setData({ showBatchModal: false, batchList: [], newBatchSubject: '' });
    page._saveAndReload();
    wx.showToast({ title: '已保存', icon: 'success' });
  }

  return {
    noop,
    openBatchModal,
    closeBatchModal,
    onBatchInput,
    addBatchSubject,
    onNewBatchInput,
    removeBatchSubject,
    saveBatch
  };
}

module.exports = createBatchModule;
