// ================================
// src/dm.ts
// Minimal GS1 parser + normalizer per spec (01, 21, 91/92/93)
// ================================

export const GS = String.fromCharCode(29); // ASCII 29 group separator

// Optional: quick RU->EN keyboard layout fix (only letters used in practice)
const RU_EN_MAP: Record<string,string> = {
  'А':'F','а':'f','Б':',','б':',','В':'D','в':'d','Г':'U','г':'u','Д':'L','д':'l','Е':'T','е':'t','Ё':'`','ё':'`','Ж':';','ж':';','З':'P','з':'p',
  'И':'B','и':'b','Й':'Q','й':'q','К':'R','к':'r','Л':'K','л':'k','М':'V','м':'v','Н':'Y','н':'y','О':'J','о':'j','П':'G','п':'g','Р':'K','р':'k',
  'С':'S','с':'s','Т':'N','т':'n','У':'E','у':'e','Ф':'A','ф':'a','Х':'[','х':'[','Ц':'W','ц':'w','Ч':'[','ч':'[','Ш':'I','ш':'i','Щ':']','щ':']',
  'Ъ':'}','ъ':'}','Ы':'S','ы':'s','Ь':']','ь':']','Э':'"','э':'"','Ю':'.','ю':'.','Я':'Z','я':'z'
};

export function ruToEnByLayout(s: string): string {
  return s.replace(/[А-Яа-яЁё]/g, ch => RU_EN_MAP[ch] ?? ch);
}

// Normalize various placeholders to real GS and clean input
export function normalizeRawInput(input: string, opts: NormalizeOpts = {}): string {
    let s = (input ?? '').trim();
  
    // убираем управляющие пробелы, переносы — часто мешают
    s = s.replace(/[\r\n\t]+/g, '');
  
    // ⚠️ опциональная коррекция раскладки (лучше держать выключенной)
    if (opts.ruToEn && typeof opts.ruToEnByLayout === 'function') {
      s = opts.ruToEnByLayout(s);
    }
  
    // срезаем вариационные селекторы (например, ↔️ = \u2194 + \uFE0F)
    s = s.replace(/[\uFE0E\uFE0F]/g, '');
  
    // приводим заменители к GS
    s = s
      // явные плейсхолдеры
      .replace(/<GS>|\[GS\]|\^\]/gi, GS)
      // символ ↔ (и уже без VS)
      .replace(/\u2194/g, GS)
      // реальный GS в тексте
      .replace(/\u001D/g, GS)
      // литерал "\x1D"
      .replace(/\\x1d/gi, GS);
  
    // иногда кидают плейсхолдер лидера — просто убираем
    s = s.replace(/<FNC1>/gi, '').replace(/\\F/gi, '');
  
    // схлопываем повторы GS
    s = s.replace(new RegExp(GS + '+', 'g'), GS);
  
    return s;
  }

export type Gs1TailAI = '91'|'92'|'93';
export type Gs1Tail = { ai: Gs1TailAI; value: string; hadLeadingGs: boolean };
export type Gs1Payload = {
  gtin: string;
  serial: string;         // 1..20
  tails: Gs1Tail[];
  prettyAI: string;       // (01) ... (21) ... (9x) ...
  rawWithGS: string;      // 01...21...<GS>9x...
  aiText: string;         // (01)...(21)...<GS>(9x)...
};

function isDigits(s: string, len: number): boolean { return s.length === len && /^[0-9]+$/.test(s); }
function isAI(s: string, i: number): Gs1TailAI | null { const a=s.slice(i,i+2); return (a==='91'||a==='92'||a==='93')?a as Gs1TailAI:null; }
function isValid92(val: string): boolean { return (val.length===44||val.length===88) && /^[A-Za-z0-9+\/=\-_.]*$/.test(val); }

export function parseGs1(inputNormalized: string): Gs1Payload {
  const s = inputNormalized;
  let i = 0;

  if (s.slice(i,i+2)!=='01') throw new Error('E01_BAD_GTIN: строка не начинается с (01)'); i+=2;
  const gtin = s.slice(i,i+14); if (!isDigits(gtin,14)) throw new Error('E01_BAD_GTIN: (01) — 14 цифр'); i+=14;
  if (s.slice(i,i+2)!=='21') throw new Error('E21_MISSING: отсутствует (21)'); i+=2;

  let serial=''; 
  while (i<s.length) {
    const ch=s[i]; if (ch===GS) break;
    const ai=isAI(s,i); if (ai) break;
    serial+=ch; i++;
    if (serial.length>20) throw new Error('E21_LEN: (21) превышает 20 символов GS1');
  }
  if (serial.length<1) throw new Error('E21_LEN: (21) пустой');

  const tails: Gs1Tail[] = [];
  while (i<s.length) {
    let had=false; if (s[i]===GS) { had=true; i++; }
    const ai=isAI(s,i); if (!ai) throw new Error(`EAI_UNKNOWN @${i}`); i+=2;

    if (ai==='91'||ai==='93') {
      const v=s.slice(i,i+4); if (v.length<4) throw new Error(`E${ai}_LEN`);
      tails.push({ ai, value:v, hadLeadingGs:had }); i+=4;
    } else {
      let v=''; 
      while(i<s.length && s[i]!==GS){ const nxt=isAI(s,i); if(nxt) break; v+=s[i++]; }
      if(!isValid92(v)) throw new Error('E92_LEN');
      tails.push({ ai:'92', value:v, hadLeadingGs:had });
    }
  }

  const prettyAI = [`(01) ${gtin}`, `(21) ${serial}`, ...tails.map(t=>`(${t.ai}) ${t.value}`)].join(' ');
  const aiText   = [`(01)${gtin}`, `(21)${serial}`, ...tails.map(t=>`<GS>(${t.ai})${t.value}`)].join('');
  const rawWithGS= ['01'+gtin, '21'+serial, ...tails.map(t=>GS+t.ai+t.value)].join('');
  return { gtin, serial, tails, prettyAI, rawWithGS, aiText };
}

export function parseFromUserInput(raw: string): Gs1Payload {
  return parseGs1(normalizeRawInput(raw));
}
