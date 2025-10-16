// Клиентский helper (TypeScript). Вызывается из UI при клике "Экспорт PNG/PDF".
// Передаёт gs1-строку (с символами 0x1D для разделителей) на сервер.
export async function exportOnServer(gs1Text: string, format: 'png' | 'pdf' = 'png') {
    // Убедитесь, что внутри gs1Text символ 0x1D стоит в нужных местах:
    // Например: '(01)01234567890128' + '\x1D' + '(17)250101' + '\x1D' + '(10)ABC123'
    const body = { format, gs1: gs1Text };
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const msg = await resp.text();
      throw new Error('Server export failed: ' + msg);
    }
    const blob = await resp.blob();
    const filename = `gs1-dm.${format === 'png' ? 'png' : 'pdf'}`;
    // Скачивание файла в браузере
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }