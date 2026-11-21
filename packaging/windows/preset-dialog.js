// Supply the text-entry dialog that the original browser action expects.
document.addEventListener('click', event => {
  if (event.fromPresetDialog || !event.target.closest('#savePreset')) return;
  event.stopImmediatePropagation();
  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<label>這份方案要叫什麼名字？ <input maxlength="50" autofocus></label> <button type="button">儲存</button> <button type="button">取消</button>';
  dialog.style.cssText = 'background:#162535;color:#e7f1fa;border:1px solid #456075;border-radius:8px;padding:24px';
  const input = dialog.querySelector('input');
  function save() {
    const name = input.value.trim();
    if (!name) return input.focus();
    // Reuse v0.5 validation, scheme storage and rendering.
    const original = window.prompt;
    try {
      dialog.close();
      window.prompt = () => name;
      const button = document.querySelector('#savePreset');
      const replay = new MouseEvent('click', {bubbles:true});
      Object.defineProperty(replay, 'fromPresetDialog', {value:true});
      button.dispatchEvent(replay);
    } finally { window.prompt = original; }
  }
  const [ok, cancel] = dialog.querySelectorAll('button');
  ok.onclick = save;
  cancel.onclick = () => dialog.close();
  input.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) save(); };
  dialog.onclose = () => dialog.remove();
  document.body.appendChild(dialog);
  dialog.showModal();
}, { capture:true });
