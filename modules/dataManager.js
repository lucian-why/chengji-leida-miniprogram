/**
 * 数据管理模块
 * 负责：首次启动检测、示例数据注入、清除、Excel 导入导出
 */
const storage = require('../utils/storage');
const XLSX = require('../utils/xlsx');

function createDataManager(page) {
  function _checkFirstLaunch() {
    if (wx.getStorageSync('hasLaunched')) return;
    const profileId = page._getActiveProfileId();
    if (!profileId) return;

    _injectDemoData(profileId, { silent: true });
    wx.setStorageSync('hasLaunched', true);
  }

  function _injectDemoData(profileId, options) {
    options = options || {};
    const allExams = storage.getExamsAll();

    const demoExams = [
      {
        id: 'demo_20120618',
        profileId,
        name: '小升初考试',
        startDate: '2012-06-18',
        endDate: '2012-06-18',
        subjects: [
          { name: '语文', score: 90, fullScore: 100, classRank: 5, gradeRank: 24 },
          { name: '数学', score: 100, fullScore: 100, classRank: 1, gradeRank: 8 },
          { name: '英语', score: 93, fullScore: 100, classRank: 4, gradeRank: 19 }
        ],
        totalClassRank: 2,
        totalGradeRank: 15,
        classTotal: 42,
        gradeTotal: 320,
        notes: '那时候觉得考上好初中，就像人生已经赢了一半。回头看，原来只是第一次认真和世界打招呼。',
        createdAt: new Date('2012-06-18').toISOString()
      },
      {
        id: 'demo_20180625',
        profileId,
        name: '中招考试',
        startDate: '2018-06-25',
        endDate: '2018-06-26',
        subjects: [
          { name: '语文', score: 89, fullScore: 120, classRank: 16, gradeRank: 94 },
          { name: '数学', score: 108, fullScore: 120, classRank: 6, gradeRank: 32 },
          { name: '英语', score: 110, fullScore: 120, classRank: 5, gradeRank: 28 },
          { name: '物理', score: 96, fullScore: 100, classRank: 8, gradeRank: 41 },
          { name: '化学', score: 91, fullScore: 100, classRank: 10, gradeRank: 53 },
          { name: '生物', score: 95, fullScore: 100, classRank: 7, gradeRank: 38 }
        ],
        totalClassRank: 8,
        totalGradeRank: 43,
        classTotal: 48,
        gradeTotal: 620,
        notes: '初三那年第一次知道，原来努力和结果之间，还隔着睡眠、情绪和一点点运气。',
        createdAt: new Date('2018-06-26').toISOString()
      },
      {
        id: 'demo_20210607',
        profileId,
        name: '高考',
        startDate: '2021-06-07',
        endDate: '2021-06-08',
        subjects: [
          { name: '语文', score: 120, fullScore: 150, classRank: 18, gradeRank: 228 },
          { name: '数学', score: 89, fullScore: 150, classRank: 39, gradeRank: 462 },
          { name: '英语', score: 128, fullScore: 150, classRank: 9, gradeRank: 136 },
          { name: '物理', score: 78, fullScore: 110, classRank: 24, gradeRank: 326 },
          { name: '化学', score: 72, fullScore: 100, classRank: 21, gradeRank: 298 },
          { name: '生物', score: 64, fullScore: 90, classRank: 27, gradeRank: 344 }
        ],
        totalClassRank: 29,
        totalGradeRank: 366,
        classTotal: 55,
        gradeTotal: 1200,
        notes: '高考那两天没有想象中惊天动地，更多是安静。走出考场时才意识到，原来青春真的会在某个下午结束。',
        createdAt: new Date('2021-06-08').toISOString()
      },
      {
        id: 'demo_20240628',
        profileId,
        name: '大学期末考试',
        startDate: '2024-06-28',
        endDate: '2024-06-29',
        subjects: [
          { name: '专业课一', score: 86, fullScore: 100, classRank: 12, gradeRank: 48 },
          { name: '专业课二', score: 81, fullScore: 100, classRank: 16, gradeRank: 62 },
          { name: '学术写作', score: 89, fullScore: 100, classRank: 8, gradeRank: 35 },
          { name: '英语', score: 78, fullScore: 100, classRank: 19, gradeRank: 80 }
        ],
        totalClassRank: 11,
        totalGradeRank: 44,
        classTotal: 36,
        gradeTotal: 180,
        notes: '大学第一次不再只想考高分了，开始偷偷问自己：我学这些，是为了成为怎样的人。',
        createdAt: new Date('2024-06-29').toISOString()
      },
      {
        id: 'demo_20251221',
        profileId,
        name: '研究生考试',
        startDate: '2025-12-21',
        endDate: '2025-12-22',
        subjects: [
          { name: '政治', score: 73, fullScore: 100, classRank: 14, gradeRank: 70 },
          { name: '英语', score: 79, fullScore: 100, classRank: 10, gradeRank: 52 },
          { name: '专业课一', score: 121, fullScore: 150, classRank: 8, gradeRank: 40 },
          { name: '专业课二', score: 126, fullScore: 150, classRank: 6, gradeRank: 31 }
        ],
        totalClassRank: 7,
        totalGradeRank: 34,
        classTotal: 28,
        gradeTotal: 420,
        notes: '那时已经不再急着证明自己了，只想把这些年散掉的心，一点点重新收回来。',
        createdAt: new Date('2025-12-22').toISOString()
      },
      {
        id: 'demo_20270930',
        profileId,
        name: '毕业后第一年',
        startDate: '2027-09-30',
        endDate: '2027-09-30',
        subjects: [
          { name: '自我认同', score: 58, fullScore: 100 },
          { name: '爱与被爱', score: 64, fullScore: 100 },
          { name: '身体能量', score: 92, fullScore: 100 },
          { name: '世界感受', score: 72, fullScore: 100 },
          { name: '稳定感', score: 46, fullScore: 100 },
          { name: '幸福感', score: 55, fullScore: 100 }
        ],
        notes: '第一次领工资时很开心，第一次熬到凌晨改方案也是真的累。原来长大不是突然会了，而是硬着头皮继续往前。',
        createdAt: new Date('2027-09-30').toISOString()
      },
      {
        id: 'demo_20351018',
        profileId,
        name: '35岁阶段回顾',
        startDate: '2035-10-18',
        endDate: '2035-10-18',
        subjects: [
          { name: '自我认同', score: 98, fullScore: 100 },
          { name: '爱与被爱', score: 99, fullScore: 100 },
          { name: '身体能量', score: 86, fullScore: 100 },
          { name: '世界感受', score: 98, fullScore: 100 },
          { name: '稳定感', score: 99, fullScore: 100 },
          { name: '幸福感', score: 98, fullScore: 100 }
        ],
        notes: '35岁并没有变成小时候想象的“大人模样”，只是终于学会对自己宽一点，也对身边的人更柔软一点。',
        createdAt: new Date('2035-10-18').toISOString()
      },
      {
        id: 'demo_20601103',
        profileId,
        name: '60岁人生回顾',
        startDate: '2060-11-03',
        endDate: '2060-11-03',
        subjects: [
          { name: '自我认同', score: 94, fullScore: 100 },
          { name: '爱与被爱', score: 96, fullScore: 100 },
          { name: '身体能量', score: 74, fullScore: 100 },
          { name: '世界感受', score: 95, fullScore: 100 },
          { name: '稳定感', score: 96, fullScore: 100 },
          { name: '幸福感', score: 97, fullScore: 100 }
        ],
        notes: '到了这个年纪才明白，所谓圆满不是没有遗憾，而是终于能微笑着和自己的一生坐下来聊一聊。',
        createdAt: new Date('2060-11-03').toISOString()
      }
    ];

    const demoIds = new Set(demoExams.map(exam => exam.id));
    const filtered = allExams.filter(exam => !demoIds.has(exam.id));
    storage.saveExamsAll(filtered.concat(demoExams));
    page._saveAndReload();

    if (!options.silent) {
      wx.showToast({ title: '已添加人生档案', icon: 'success' });
    }
  }

  function addDemoData() {
    const profileId = page._getActiveProfileId();
    if (!profileId) return;

    if (page.data.exams.length > 0) {
      page.setData({
        showConfirmModal: true,
        confirmIcon: '📎',
        confirmIconType: 'info',
        confirmTitle: '添加示例数据',
        confirmMessage: '当前档案里已经有数据，继续添加会把人生档案示例考试追加进来。',
        confirmOkText: '继续添加',
        confirmOkClass: 'btn-primary',
        confirmShowCancel: true,
        _confirmCallback: () => _injectDemoData(profileId)
      });
      return;
    }

    _injectDemoData(profileId);
  }

  function clearDemoData() {
    const profileId = page._getActiveProfileId();
    if (!profileId) return;

    const allExams = storage.getExamsAll();
    const filtered = allExams.filter(exam => !exam.id.startsWith('demo_'));

    if (filtered.length === allExams.length) {
      wx.showToast({ title: '没有示例数据可清除', icon: 'none' });
      return;
    }

    page.setData({
      showConfirmModal: true,
      confirmIcon: '🗏',
      confirmIconType: 'warn',
      confirmTitle: '清除示例数据',
      confirmMessage: '将删除所有示例考试记录，你自己的真实数据不会受影响。',
      confirmOkText: '确认清除',
      confirmOkClass: 'btn-danger',
      confirmShowCancel: true,
      _confirmCallback: () => {
        storage.saveExamsAll(filtered);
        page._saveAndReload();
        wx.showToast({ title: '示例数据已清除', icon: 'success' });
      }
    });
  }

  function exportData() {
    const profileId = page._getActiveProfileId();
    const profile = page.data.profiles[page.data.activeProfileIndex];
    const exams = storage.getExams(profileId);

    if (exams.length === 0) {
      wx.showToast({ title: '暂无数据可导出', icon: 'none' });
      return;
    }

    const rows = [];
    rows.push([
      '考试名称',
      '开始日期',
      '结束日期',
      '备注',
      '班级排名',
      '年级排名',
      '班级人数',
      '年级人数',
      '科目',
      '成绩',
      '满分',
      '科目班级排名',
      '科目年级排名',
      '排除统计'
    ]);

    exams.forEach(exam => {
      const subjects = exam.subjects || [];
      if (subjects.length === 0) {
        rows.push([
          exam.name,
          exam.startDate || '',
          exam.endDate || '',
          exam.notes || '',
          exam.totalClassRank || '',
          exam.totalGradeRank || '',
          exam.classTotal || '',
          exam.gradeTotal || '',
          '',
          '',
          '',
          '',
          '',
          exam.excluded ? '是' : '否'
        ]);
        return;
      }

      subjects.forEach((subject, index) => {
        rows.push([
          index === 0 ? exam.name : '',
          index === 0 ? (exam.startDate || '') : '',
          index === 0 ? (exam.endDate || '') : '',
          index === 0 ? (exam.notes || '') : '',
          index === 0 ? (exam.totalClassRank || '') : '',
          index === 0 ? (exam.totalGradeRank || '') : '',
          index === 0 ? (exam.classTotal || '') : '',
          index === 0 ? (exam.gradeTotal || '') : '',
          subject.name || '',
          subject.score,
          subject.fullScore || 100,
          subject.classRank || '',
          subject.gradeRank || '',
          index === 0 ? (exam.excluded ? '是' : '否') : ''
        ]);
      });
    });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 18 },
      { wch: 12 },
      { wch: 12 },
      { wch: 15 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 8 },
      { wch: 8 },
      { wch: 8 },
      { wch: 12 },
      { wch: 12 },
      { wch: 8 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '成绩数据');
    const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

    const fileName = `${profile ? profile.name : '成绩'}_成绩数据.xlsx`;
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;

    wx.getFileSystemManager().writeFile({
      filePath,
      data: workbookData,
      encoding: 'binary',
      success: () => {
        wx.shareFileMessage({
          filePath,
          fileName,
          success: () => {
            wx.showToast({ title: '导出成功', icon: 'success' });
          },
          fail: () => {
            wx.showModal({
              title: '导出成功',
              content: '文件已经保存，是否立即打开查看？',
              confirmText: '打开',
              success: res => {
                if (!res.confirm) return;
                wx.openDocument({
                  filePath,
                  showMenu: true,
                  fail: () => {
                    wx.showToast({ title: '无法打开文件', icon: 'none' });
                  }
                });
              }
            });
          }
        });
      },
      fail: () => {
        wx.showToast({ title: '导出失败', icon: 'none' });
      }
    });
  }

  function importData() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'xls'],
      success: res => _parseExcel(res.tempFiles[0].path)
    });
  }

  function _parseExcel(filePath) {
    try {
      const fileData = wx.getFileSystemManager().readFileSync(filePath, 'binary');
      const workbook = XLSX.read(fileData, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (rows.length < 2) {
        wx.showToast({ title: '文件中没有数据', icon: 'none' });
        return;
      }

      const profileId = page._getActiveProfileId();
      const allExams = storage.getExamsAll();
      let importCount = 0;
      let lastExam = null;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;

        const examName = String(row[0]).trim();
        const startDate = row[1] ? String(row[1]).trim() : '';
        const endDate = row[2] ? String(row[2]).trim() : '';
        const notes = row[3] ? String(row[3]).trim() : '';
        const totalClassRank = row[4] ? Number(row[4]) : undefined;
        const totalGradeRank = row[5] ? Number(row[5]) : undefined;
        const classTotal = row[6] ? Number(row[6]) : undefined;
        const gradeTotal = row[7] ? Number(row[7]) : undefined;
        const subjectName = row[8] ? String(row[8]).trim() : '';
        const score = row[9] !== undefined ? Number(row[9]) : undefined;
        const fullScore = row[10] ? Number(row[10]) : 100;
        const subjectClassRank = row[11] ? Number(row[11]) : undefined;
        const subjectGradeRank = row[12] ? Number(row[12]) : undefined;
        const excluded = row[13] === '是';

        if (examName && (!lastExam || lastExam.name !== examName)) {
          lastExam = {
            id: `exam_${Date.now()}_${importCount}`,
            profileId,
            name: examName,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            notes: notes || undefined,
            totalClassRank,
            totalGradeRank,
            classTotal,
            gradeTotal,
            excluded,
            subjects: [],
            createdAt: new Date().toISOString()
          };
          allExams.push(lastExam);
          importCount += 1;
        }

        if (subjectName && score !== undefined && lastExam) {
          lastExam.subjects.push({
            name: subjectName,
            score,
            fullScore,
            classRank: subjectClassRank || undefined,
            gradeRank: subjectGradeRank || undefined
          });
        }
      }

      if (importCount > 0) {
        storage.saveExamsAll(allExams);
        page._saveAndReload();
        wx.showToast({ title: `成功导入 ${importCount} 场考试`, icon: 'success' });
      } else {
        wx.showToast({ title: '未识别到有效数据', icon: 'none' });
      }
    } catch (error) {
      console.error('导入失败', error);
      wx.showToast({ title: '导入失败，请检查文件格式', icon: 'none' });
    }
  }

  return {
    _checkFirstLaunch,
    addDemoData,
    clearDemoData,
    exportData,
    importData
  };
}

module.exports = createDataManager;
