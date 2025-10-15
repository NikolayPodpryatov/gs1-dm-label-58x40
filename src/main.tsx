// ================================
// src/main.tsx (fix: автодействия после вставки/скана без ложной ошибки)
// ================================

import React, { useEffect, useRef, useState } from 'react';
import { parseFromUserInput, GS } from './dm';
import { renderGs1DmToCanvas } from './barcode';
import { buildLabelPdf } from './pdf';
import { createRoot } from 'react-dom/client';
import logo from './logo.png';

// ---- Tiny beeper (WebAudio, без аудиофайлов) ----
class Beeper {
  private ctx: AudioContext | null = null;
  private async ensureCtx() {
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }
  private tone(freq: number, durMs = 120, type: OscillatorType = 'sine', gain = 0.05, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.linearRampToValueAtTime(0, t0 + durMs / 1000);
    osc.stop(t0 + durMs / 1000);
  }
  async ok() {
    await this.ensureCtx();
    this.tone(880, 90, 'sine', 0.06, 0);
    this.tone(1320, 110, 'sine', 0.05, 0.09);
  }
  async err() {
    await this.ensureCtx();
    this.tone(360, 140, 'square', 0.08, 0);
    this.tone(260, 180, 'square', 0.07, 0.12);
  }
}
const beeper = new Beeper();

// ---- App ----
const el = document.getElementById('root');
if (!el) throw new Error('Root element #root not found');
createRoot(el).render(<App />);

export default function App() {
  const [scan, setScan] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [payload, setPayload] = useState<ReturnType<typeof parseFromUserInput>>();
  const [pendingAuto, setPendingAuto] = useState<null | 'paste' | 'enter'>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // --- Разбор ввода (легкая задержка для сканера/вставки) ---
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (!scan.trim()) { setPayload(undefined); setError(undefined); return; }
        const hasCyr = /[А-Яа-яЁё]/.test(scan);
        if (hasCyr) {
          setError('Смените раскладку клавиатуры на EN');
          setPayload(undefined);
        } else {
          setError(undefined);
          const p = parseFromUserInput(scan);
          setPayload(p);
        }
      } catch (e: any) {
        setPayload(undefined);
        setError(e?.message ?? String(e));
      }
    }, 80);
    return () => clearTimeout(id);
  }, [scan]);

  // --- Рендер превью ---
  useEffect(() => {
    (async () => {
      if (!payload || !canvasRef.current) return;
      try { await renderGs1DmToCanvas(canvasRef.current, payload.prettyAI, 4); }
      catch (e) { console.error(e); }
    })();
  }, [payload]);

  // --- Централизованный автозапуск печати, чтобы не было гонок состояния ---
  useEffect(() => {
    if (!pendingAuto) return;
    if (!scan.trim()) { setPendingAuto(null); return; }
    if (error) { void beeper.err(); setPendingAuto(null); return; }
    if (payload) { void doAutoPrint(); setPendingAuto(null); return; }
    // если payload ещё не готов — подождём следующего цикла (эффект перезапустится)
  }, [pendingAuto, error, payload, scan]);

  async function onPrint() {
    if (!payload) return;
    const caption = payload.rawWithGS.replaceAll(GS, '<GS>').replace(/[^[ -~]]/g, '');
    const blob = await buildLabelPdf(payload.rawWithGS, { caption, ai: payload.prettyAI });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  async function doAutoPrint() {
    if (isPrinting) return;
    if (!payload || error) { await beeper.err(); return; }
    try {
      setIsPrinting(true);
      await beeper.ok();
      await onPrint();
      setScan('');
    } finally {
      setIsPrinting(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Не печатаем сразу — ставим флажок и даём парсеру шанс обновиться
      setPendingAuto('enter');
    }
  }

  function onPaste() {
    // Вставка изменила текст позже, чем этот хендлер — просто ставим флажок
    setPendingAuto('paste');
  }

  return (
    <div style={{ fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif', padding: 16, maxWidth: 760, margin: '0 auto' }}>      
      <header style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: 16, marginBottom: 8,}}>
        <img src={logo} alt="dm-labels logo" style={{ width: 100, height: 100, borderRadius: 16, objectFit: 'contain',}}/>
      </header>
      <h1 style={{ margin: '8px 0 12px' }}>Печать DataMatrix</h1>

      <label style={{ display: 'block', fontSize: 13, color: '#334155', marginBottom: 6 }}>Ввод (сканер/вставка):</label>
      <textarea
        value={scan}
        onChange={e => setScan(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={'напр.: 0100087703157811215NtEuRRYbQofV93M/r1'}
        rows={4}
        style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: 8, padding: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
      />

      {error && (
        <div style={{ marginTop: 10, padding: 10, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8 }}>
          <strong>Ошибка:</strong> {error}
        </div>
      )}

      {payload && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: '#334155', marginBottom: 6 }}>Превью DataMatrix (GS1):</div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, display: 'inline-block', background: '#fff' }}>
              <canvas ref={canvasRef} width={220} height={220} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, color: '#334155', marginBottom: 6 }}>Разобрано:</div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
              <div>(01) {payload.gtin}</div>
              <div>(21) {payload.serial}</div>
              {payload.tails.map((t, idx) => (<div key={idx}>({t.ai}) {t.value}</div>))}
            </div>

            <div style={{ fontSize: 12, color: '#334155', marginTop: 10 }}>Строки для проверки/копирования:</div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, border: '1px dashed #e2e8f0', borderRadius: 8, padding: 10, background: '#fafafa', wordBreak: 'break-all' }}>
              <div><strong>prettyAI</strong>: {payload.prettyAI}</div>
              <div style={{ marginTop: 6 }}><strong>aiText</strong>: {payload.aiText}</div>
              <div style={{ marginTop: 6 }}><strong>raw (GS=&lt;GS&gt;)</strong>: {payload.rawWithGS.replaceAll(GS, '<GS>')}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={() => setScan('')} className="secondary" style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff' }}>Очистить</button>
        <button disabled={!payload || !!error || isPrinting} onClick={doAutoPrint} style={{ padding: '10px 14px', borderRadius: 8, border: 0, background: !payload || !!error ? '#a5b4fc' : '#4f46e5', color: '#fff' }}>{isPrinting ? 'Печать…' : 'Печать PDF 58×40'}</button>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
        Лидирующий символ FNC1, но разделители групп могут распознаваться валидаторами вроде Чекмарк также как FNC1, а не GS, хотя приложение ЧЗ распознает марку корректно.
      </div>
    </div>
  );
}
