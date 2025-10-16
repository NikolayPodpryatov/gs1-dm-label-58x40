// api/generate-experiments.js
// Экспериментальная serverless-функция. Поддерживает:
// - body.rawWithGS (строка) — в JSON используйте экранирование \u001D для GS
// - body.rawBase64 (base64) — безопасный бинарный путь (рекомендуется)
// - body.ai (parenthesized AI) — для режима gs1-parse
//
// Новое: добавлен режим 'fnc1-caret' — вставляет '^FNC1' в начало latin1-строки и включает parsefnc:true,
// чтобы BWIPP явно вставил FNC1-лидер, при этом данные содержат реальные 0x1D разделители.

import bwipjs from 'bwip-js';

function toBufferPromise(opts) {
  return new Promise((resolve, reject) => {
    try {
      bwipjs.toBuffer(opts, (err, png) => {
        if (err) reject(err); else resolve(png);
      });
    } catch (e) { reject(e); }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405; res.end('Method Not Allowed'); return;
  }

  const body = req.body || {};
  const mode = body.mode || 'all';
  const ai = body.ai || '';
  const rawWithGS = body.rawWithGS || '';
  const rawBase64 = body.rawBase64 || '';
  const scale = Math.max(1, Number(body.scale) || 4);
  const GS = String.fromCharCode(29);

  const results = {};

  async function tryGs1Parse() {
    if (!ai) return { ok: false, err: 'Missing ai (parenthesized) for gs1-parse' };
    const text = ai.replace(/\s+/g, '');
    const opts = {
      bcid: 'gs1datamatrix',
      text,
      parse: true,
      scale,
      includetext: false,
      paddingwidth: 0,
      paddingheight: 0,
    };
    try {
      const png = await toBufferPromise(opts);
      return { ok: true, pngBase64: png.toString('base64') };
    } catch (err) {
      return { ok: false, err: String(err) };
    }
  }

  async function tryExplicitGS() {
    // Prefer rawBase64 if present (safe). Otherwise use rawWithGS (JSON should contain \u001D)
    let textOrLatin1 = null;
    if (rawBase64) {
      try {
        const buf = Buffer.from(rawBase64, 'base64');
        textOrLatin1 = buf.toString('latin1'); // preserve bytes 1:1 in string
      } catch (err) {
        return { ok: false, err: 'Invalid rawBase64' };
      }
    } else {
      if (!rawWithGS && !ai) return { ok: false, err: 'Missing rawWithGS or ai to compose explicit-gs' };
      const text = rawWithGS ? rawWithGS.replace(/\s+/g, '') : ai.replace(/<GS>/g, GS).replace(/\s+/g, '');
      textOrLatin1 = Buffer.from(text, 'utf8').toString('latin1');
    }

    const opts = {
      bcid: 'datamatrix',
      text: textOrLatin1,
      parse: false,
      gs1: true,
      scale,
      includetext: false,
      paddingwidth: 0,
      paddingheight: 0,
    };
    try {
      const png = await toBufferPromise(opts);
      return { ok: true, pngBase64: png.toString('base64') };
    } catch (err) {
      return { ok: false, err: String(err) };
    }
  }

  async function tryRawBytes() {
    // raw-bytes: must supply rawBase64 (preferred) or rawWithGS (as JS string containing 0x1D)
    let latin1str = null;
    if (rawBase64) {
      try {
        const buf = Buffer.from(rawBase64, 'base64');
        latin1str = buf.toString('latin1'); // preserve byte values 1:1 in a JS string
      } catch (err) {
        return { ok: false, err: 'Invalid rawBase64' };
      }
    } else {
      if (!rawWithGS) return { ok: false, err: 'Missing rawWithGS for raw-bytes' };
      const buf = Buffer.from(rawWithGS, 'utf8');
      latin1str = buf.toString('latin1');
    }

    try {
      const opts = {
        bcid: 'datamatrix',
        text: latin1str,
        parse: false,
        scale,
        includetext: false,
        paddingwidth: 0,
        paddingheight: 0,
      };
      const png = await toBufferPromise(opts);
      return { ok: true, pngBase64: png.toString('base64') };
    } catch (err) {
      return { ok: false, err: String(err) };
    }
  }

  // Новая экспериментальная попытка: вставить '^FNC1' caret-маркер с parsefnc:true,
  // предоставляя BWIPP явный маркер вставки FNC1-лидера; данные передаются в latin1,
  // чтобы сохранить 0x1D внутри.
  async function tryFnc1Caret() {
    // prefer rawBase64, else rawWithGS or ai
    let baseLatin1 = null;
    if (rawBase64) {
      try { baseLatin1 = Buffer.from(rawBase64, 'base64').toString('latin1'); }
      catch (err) { return { ok: false, err: 'Invalid rawBase64' }; }
    } else {
      if (!rawWithGS && !ai) return { ok: false, err: 'Missing rawWithGS or ai to compose fnc1-caret' };
      const text = rawWithGS ? rawWithGS.replace(/\s+/g, '') : ai.replace(/<GS>/g, GS).replace(/\s+/g, '');
      baseLatin1 = Buffer.from(text, 'utf8').toString('latin1');
    }

    // prepend caret token; BWIPP will replace ^FNC1 when parsefnc:true
    const textWithCaret = '^FNC1' + baseLatin1;

    const opts = {
      bcid: 'datamatrix',
      text: textWithCaret,
      // instruct BWIPP to parse ^FNC1 sequences
      parsefnc: true,
      // ensure we don't enable generic AI parsing
      parse: false,
      scale,
      includetext: false,
      paddingwidth: 0,
      paddingheight: 0,
    };

    try {
      const png = await toBufferPromise(opts);
      return { ok: true, pngBase64: png.toString('base64') };
    } catch (err) {
      return { ok: false, err: String(err) };
    }
  }

  try {
    if (mode === 'all' || mode === 'gs1-parse') {
      results['gs1-parse'] = await tryGs1Parse();
    }
    if (mode === 'all' || mode === 'explicit-gs') {
      results['explicit-gs'] = await tryExplicitGS();
    }
    if (mode === 'all' || mode === 'raw-bytes') {
      results['raw-bytes'] = await tryRawBytes();
    }
    if (mode === 'all' || mode === 'fnc1-caret') {
      results['fnc1-caret'] = await tryFnc1Caret();
    }

    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ results }, null, 2));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err) }));
  }
}