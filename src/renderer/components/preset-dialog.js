/**
 * 原生 <dialog> 方案命名彈窗（補齊 Electron 不支援 window.prompt 之行為）
 */

if (typeof document !== 'undefined' && document.body?.addEventListener) {
  document.body.addEventListener(
    'click',
    event => {
      if (event.fromPresetDialog || !event.target?.closest?.('#savePreset')) return;
      event.stopImmediatePropagation();

      const dialog = document.createElement('dialog');
      dialog.className = 'preset-dialog';
      dialog.innerHTML =
        '<label>這份方案要叫什麼名字？<input maxlength="50" placeholder="例如：400張保守連兩週" autofocus></label>' +
        '<div class="dialog-actions">' +
        '<button type="button" class="btn main sm">儲存</button>' +
        '<button type="button" class="btn ghost sm">取消</button>' +
        '</div>';

      const input = dialog.querySelector('input');

      function save() {
        const name = input.value.trim();
        if (!name) return input.focus();
        const original = window.prompt;
        try {
          dialog.close();
          window.prompt = () => name;
          const button = document.querySelector('#savePreset');
          const replay = new MouseEvent('click', { bubbles: true });
          Object.defineProperty(replay, 'fromPresetDialog', { value: true });
          button.dispatchEvent(replay);
        } finally {
          window.prompt = original;
        }
      }

      const [ok, cancel] = dialog.querySelectorAll('button');
      ok.onclick = save;
      cancel.onclick = () => dialog.close();
      input.onkeydown = e => {
        if (e.key === 'Enter' && !e.isComposing) save();
      };
      dialog.onclose = () => dialog.remove();
      document.body.appendChild(dialog);
      dialog.showModal();
    },
    { capture: true }
  );
}
