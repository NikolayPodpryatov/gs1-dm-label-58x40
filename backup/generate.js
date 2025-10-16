// api/generate.js
// Production serverless function (ESM)
// Supports:
//  - { mode: 'fnc1-caret', rawBase64: '...', scale }  -> prepend '^FNC1' + parsefnc:true on datamatrix
//  - { mode: 'raw', rawBase64: '...', scale }         -> datamatrix with raw bytes
//  - { ai: '(01)...', scale }                        -> gs1datamatrix + parse:true (fallback)
import bwipjs from 'bwip-js';

function toBuffer(opts) {
  return new Promise((resolve, reject) => {
    try {
      bwipjs.toBuffer(opts, (err, png) => {
        if (err) reject(err);
        else resolve(png);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function makeLatin1FromBase64(b64) {
  return Buffer.from(b64, 'base64').toString('latin1');
}
function makeLatin1FromRawWithGS(rawWithGS) {
  return Buffer.from(rawWithGS, 'utf8').toString('latin1');
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }

    const body = req.body || {};
    const { format = 'png', scale = 4 } = body;

    // Branch 1: fnc1-caret (preferred if caller supplies raw bytes)
    if (body.mode === 'fnc1-caret' && (body.rawBase64 || body.rawWithGS)) {
      try {
        const latin1 = body.rawBase64 ? makeLatin1FromBase64(body.rawBase64) : makeLatin1FromRawWithGS(body.rawWithGS);
        const text = '^FNC1' + latin1;
        const opts = {
          bcid: 'datamatrix',
          text,
          parsefnc: true, // ask BWIPP to parse caret markers ^FNC1
          parse: false,
          scale: Math.max(1, Number(scale) || 4),
          includetext: false,
          paddingwidth: 0,
          paddingheight: 0,
        };
        const png = await toBuffer(opts);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 200;
        res.end(png);
        return;
      } catch (err) {
        console.error('fnc1-caret err', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }
    }

    // Branch 2: raw datamatrix from bytes (no caret)
    if (body.mode === 'raw' || body.rawBase64 || body.rawWithGS) {
      try {
        const latin1 = body.rawBase64 ? makeLatin1FromBase64(body.rawBase64) : makeLatin1FromRawWithGS(body.rawWithGS);
        const opts = {
          bcid: 'datamatrix',
          text: latin1,
          parse: false,
          scale: Math.max(1, Number(scale) || 4),
          includetext: false,
          paddingwidth: 0,
          paddingheight: 0,
        };
        const png = await toBuffer(opts);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 200;
        res.end(png);
        return;
      } catch (err) {
        console.error('raw generation error:', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }
    }

    // Branch 3: existing GS1 parenthesized AI => gs1datamatrix + parse:true (fallback)
    if (body.ai && typeof body.ai === 'string') {
      try {
        const text = body.ai.replace(/\s+/g, '');
        const opts = {
          bcid: 'gs1datamatrix',
          text,
          parse: true,
          scale: Math.max(1, Number(scale) || 4),
          includetext: false,
          paddingwidth: 0,
          paddingheight: 0,
        };
        const png = await toBuffer(opts);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 200;
        res.end(png);
        return;
      } catch (err) {
        console.error('gs1datamatrix error:', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }
    }

    // Nothing matched
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Missing or invalid parameters. Provide ai OR rawBase64/rawWithGS with mode.' }));
  } catch (err) {
    console.error('Generation error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: String(err) }));
  }
}