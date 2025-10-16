// ================================
// src/barcode.ts
// GS1 DataMatrix rendering via BWIPP: bcid:'gs1datamatrix' + parse:true
// Feed AI-parenthesized string '(01)...(21)...(9x)...'
// ================================

import bwipjs from 'bwip-js';

const compactAI = (ai: string) => ai.replace(/\s+/g, '');

export async function renderGs1DmToCanvas(
  canvas: HTMLCanvasElement,
  aiParenthesized: string,
  scale = 3
): Promise<void> {
  const text = compactAI(aiParenthesized);
  await new Promise<void>((resolve, reject) => {
    try {
      (bwipjs as any).toCanvas(canvas, {
        bcid: 'gs1datamatrix',
        text,
        parse: true,          // parses AIs; inserts FNC1 leader and GS where required
        scale,
        includetext: false,
        paddingwidth: 0,
        paddingheight: 0,
      });
      resolve();
    } catch (e) { reject(e); }
  });
}

export async function datamatrixPngBytes(aiParenthesized: string, scale = 4): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  await renderGs1DmToCanvas(canvas, aiParenthesized, scale);
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1] ?? '';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
