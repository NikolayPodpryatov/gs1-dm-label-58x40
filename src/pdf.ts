// ================================
// src/pdf.ts
// Build a 58x40 mm label PDF with GS1 DM (BWIPP) + centered matrix + wrapped ASCII-safe caption
// ================================

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import bwipjs from 'bwip-js'
import { GS } from './dm'

const MM_TO_PT = 2.83465
const mm = (v: number) => v * MM_TO_PT

export type LabelOptions = {
  widthMm?: number   // default 58
  heightMm?: number  // default 40
  marginMm?: number  // default 3
  dmBoxMm?: number   // default auto = min(width,height)-2*margin-6 (мы берем -8, оставляя место для подписи)
  caption?: string   // человекочитаемая подпись (мы ещё её санитайзим)
  ai: string         // REQUIRED: скобочная AI-строка '(01)...(21)...(9x)...' для рендера
}

// ---- helpers ----

// Рендерим GS1 DM в offscreen-canvas из AI-строки
async function pngFromAI(aiParenthesized: string, scale = 6): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  const text = aiParenthesized.replace(/\s+/g, '')
  await new Promise<void>((resolve, reject) => {
    try {
      ;(bwipjs as any).toCanvas(canvas, {
        bcid: 'gs1datamatrix',
        text,
        parse: true,          // BWIPP: распарсит AIs, поставит FNC1-лидер и FNC1/GS-разделители по правилам
        scale,
        includetext: false,
        paddingwidth: 0,
        paddingheight: 0,
      })
      resolve()
    } catch (e) { reject(e) }
  })
  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.split(',')[1] ?? ''
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// Делает подпись ASCII-безопасной и заменяет GS на <GS>
function makeSafeCaption(rawWithGS: string, custom?: string): string {
  const src = (custom ?? rawWithGS).replaceAll(GS, '<GS>')
  return src.replace(/[^\x20-\x7E]/g, '') // только печатные ASCII
}

// Простой перенос по словам с хард-катом очень длинных токенов
function wrapTextLines(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = []
  const words = text.split(/\s+/).filter(Boolean)
  let line = ''
  for (const w of words) {
    const test = line ? line + ' ' + w : w
    if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
      line = test
    } else {
      if (line) lines.push(line)
      if (font.widthOfTextAtSize(w, fontSize) <= maxWidth) {
        line = w
      } else {
        // режем длинный токен
        let buf = ''
        for (const ch of w) {
          const t2 = buf + ch
          if (font.widthOfTextAtSize(t2, fontSize) > maxWidth) { lines.push(buf); buf = ch } else buf = t2
        }
        line = buf
      }
    }
  }
  if (line) lines.push(line)
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

  // Чуть меньше бокса под DM, чтобы оставить место для подписи (увеличиваем последнее значение для уменьшения матрицы)
  const dmSide = mm(
    opts.dmBoxMm ??
    Math.min((opts.widthMm ?? 58), (opts.heightMm ?? 40)) - 2 * (opts.marginMm ?? 3) - 12
  )

  // 1) PNG DM (BWIPP + AI-строка)
  const png = await pngFromAI(opts.ai, 6)
  const pngEmbed = await pdf.embedPng(png)

  // 2) Подпись: safe + перенос по словам
  const captionSafe = makeSafeCaption(rawWithGS, opts.caption)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontSize = 5                  // компактный текст
  const lineGap = mm(0.5)             // межстрочный интервал
  const maxTextWidth = width - 2 * margin
  const lines = wrapTextLines(captionSafe, font, fontSize, maxTextWidth)
  const captionHeight = lines.length * fontSize + Math.max(0, lines.length - 1) * lineGap + mm(2) // +2мм отступ под DM

  // 3) Центрируем DM по горизонтали; по вертикали — над подписью
  const dmW = dmSide, dmH = dmSide
  const dmX = (width - dmW) / 2
  const dmY = Math.max(margin + captionHeight, (height - dmH - captionHeight) / 2 + captionHeight)

  page.drawImage(pngEmbed, { x: dmX, y: dmY, width: dmW, height: dmH })

  // 4) Рисуем подпись по центру, строками, под матрицей
  let y = dmY - mm(2) - fontSize
  for (const ln of lines) {
    if (y < mm(2)) break // нижнее поле
    const tw = font.widthOfTextAtSize(ln, fontSize)
    const x = (width - tw) / 2
    page.drawText(ln, { x, y, size: fontSize, font, color: rgb(0, 0, 0) })
    y -= (fontSize + lineGap)
  }

  const bytes = await pdf.save()
  return new Blob([bytes], { type: 'application/pdf' })
}
