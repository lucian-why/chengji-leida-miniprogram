/**
 * 通用确认弹窗模块
 * 提供 open/ok/close 三个方法
 * 各模块通过设置 confirm* 系列 data + _confirmCallback 来使用
 * 对应原代码 L1119-1131 区段
 */
function createModalModule(page) {

  function closeConfirmModal() {
    page.setData({ showConfirmModal: false, _confirmCallback: null });
  }

  function onConfirmOk() {
    const cb = page.data._confirmCallback;
    page.setData({ showConfirmModal: false, _confirmCallback: null });
    if (cb && typeof cb === 'function') { cb(); }
  }

  return {
    closeConfirmModal,
    onConfirmOk
  };
}

module.exports = createModalModule;
