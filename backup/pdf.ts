// ================================
// src/pdf.ts
// Build a 58x40 mm label PDF with GS1 DM (server-side generation of DM PNG) + centered matrix + wrapped ASCII-safe caption
// ================================

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { GS } from './dm'

const MM_TO_PT = 2.83465
const mm = (v: number) => v * MM_TO_PT

export type LabelOptions = {
  widthMm?: number   // default 58
  heightMm?: number  // default 40
  marginMm?: number  // default 3
  dmBoxMm?: number   // default auto
  caption?: string
  ai: string         // REQUIRED: скобочная AI-строка '(01)...(21)...(9x)...' для рендера
}

// ---- helpers ----

/** Преобразует JS-строку (которая может содержать GS U+001D) в base64,
 *  сохраняя байт-значения 0..255 (latin1-style).
 *  Работает корректно для строк, которые у нас генерируются (ASCII + GS).
 */
function stringToBase64Latin1(s: string): string {
  let bin = ''
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i) & 0xff
    bin += String.fromCharCode(code)
  }
  // btoa доступен в браузере
  return btoa(bin)
}

// Рендерим GS1 DM на сервере и получаем PNG как Uint8Array
// Параметры:
//  - aiParenthesized: скобочная AI-строка (например "(01)...")
//  - rawWithGS: опциональная строка, где реальные разделители групп — символ 0x1D (GS)
// Если rawWithGS указан -> используем режим fnc1-caret (rawBase64) на сервере.
// Если нет -> fallback на ai + gs1datamatrix.
async function pngFromAI(aiParenthesized: string, rawWithGS?: string, scale = 6): Promise<Uint8Array> {
  if (rawWithGS && rawWithGS.length > 0) {
    const rawBase64 = stringToBase64Latin1(rawWithGS.replace(/\s+/g, ''))
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'fnc1-caret', rawBase64, scale }),
    })
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      throw new Error('Server-side generation failed: ' + (txt || resp.statusText))
    }
    const arrBuf = await resp.arrayBuffer()
    return new Uint8Array(arrBuf)
  } else {
    // fallback: старый путь — parenthesized AI -> gs1datamatrix
    const ai = (aiParenthesized || '').replace(/\s+/g, '')
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai, scale }),
    })
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      throw new Error('Server-side generation failed: ' + (txt || resp.statusText))
    }
    const arrBuf = await resp.arrayBuffer()
    return new Uint8Array(arrBuf)
  }
}

// Делает подпись ASCII-безопасной и заменяет GS на <GS>
function makeSafeCaption(rawWithGS: string, custom?: string): string {
  if (custom) return custom
  const replaced = rawWithGS.replaceAll(GS, '<GS>')
  return replaced.replace(/[^\x20-\x7E\u0400-\u04FF]/g, '')
}

// Простой перенос по словам с хард-катом очень длинных токенов
function wrapTextLines(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur ? cur.length + 1 + w.length : w.length) <= maxCharsPerLine) {
      cur = cur ? cur + ' ' + w : w
    } else {
      if (cur) lines.push(cur)
      if (w.length <= maxCharsPerLine) cur = w
      else {
        for (let i = 0; i < w.length; i += maxCharsPerLine) {
          lines.push(w.slice(i, i + maxCharsPerLine))
        }
        cur = ''
      }
    }
  }
  if (cur) lines.push(cur)
  return lines
}

// ---- main ----

export async function buildLabelPdf(rawWithGS: string, opts: LabelOptions): Promise<Blob> {
  if (!opts?.ai || !opts.ai.trim()) {
    throw new Error('buildLabelPdf: opts.ai (parenthesized AI string) is required')
  }

  const width = mm(opts.widthMm ?? 58)
  const height = mm(opts.heightMm ?? 40)
  const margin = mm(opts.marginMm ?? 3)

  const pdf = await PDFDocument.create()
  const page = pdf.addPage([width, height])

  // Чуть меньше бокса под DM, чтобы оставить место для подписи
  const dmSide = mm(
    opts.dmBoxMm ??
      Math.min((opts.widthMm ?? 58), (opts.heightMm ?? 40)) - 2 * (opts.marginMm ?? 3) - 12
  )

  // Получаем PNG DM с сервера — ВАЖНО: передаём rawWithGS как второй аргумент
  const pngBytes = await pngFromAI(opts.ai, rawWithGS, 6)

  // Вставляем PNG в pdf-lib
  const pngImage = await pdf.embedPng(pngBytes)

  const imgWidth = dmSide
  const imgHeight = dmSide

  // Центрируем DM по горизонтали; по вертикали — располагаем над подписью (как раньше)
  const dmX = (width - imgWidth) / 2
  const dmY = height - margin - imgHeight

  page.drawImage(pngImage, {
    x: dmX,
    y: dmY,
    width: imgWidth,
    height: imgHeight,
  })

  // Подпись (caption) под матрицей — ASCII-safe и центрированная
  const caption = makeSafeCaption(rawWithGS, opts.caption)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontSize = 6
  const lineGap = 2

  const approxCharsPerLine = Math.floor((width - margin * 2) / (fontSize * 0.5))
  const lines = wrapTextLines(caption, Math.max(20, approxCharsPerLine))

  let textY = dmY - mm(2) - fontSize
  for (const ln of lines) {
    if (textY < mm(1)) break
    const textWidth = font.widthOfTextAtSize(ln, fontSize)
    const tx = (width - textWidth) / 2
    page.drawText(ln, { x: tx, y: textY, size: fontSize, font, color: rgb(0, 0, 0) })
    textY -= fontSize + lineGap
  }

  const bytes = await pdf.save()
  return new Blob([bytes], { type: 'application/pdf' })
}