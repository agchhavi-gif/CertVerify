const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp'];

const extractFromPDF = async (filePath) => {
  const data = await pdfParse(fs.readFileSync(filePath));
  return data.text;
};

/**
 * OCR the image twice: automatic layout (keeps line order) and sparse text
 * (catches words scattered across decorative certificate designs).
 * Returns one text per pass.
 */
const extractFromImage = async (filePath) => {
  // cachePath: use the bundled backend/eng.traineddata regardless of the working directory
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: () => {},
    cachePath: path.join(__dirname, '../..'),
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const texts = [];
    for (const psm of [Tesseract.PSM.AUTO, Tesseract.PSM.SPARSE_TEXT]) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const { data } = await worker.recognize(filePath);
      texts.push(data.text);
    }
    return texts;
  } finally {
    await worker.terminate();
  }
};

/**
 * Normalize unicode punctuation and whitespace, split into clean lines.
 */
const toLines = (rawText) =>
  rawText
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[  -​ ﻿]/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0);

// ─────────────────────────── Dates ───────────────────────────

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const monthNum = (name) => MONTHS[name.slice(0, 3).toLowerCase()];

/**
 * Build a "YYYY-MM-DD" string without going through Date/toISOString,
 * which shifts the day in timezones ahead of UTC (e.g. IST).
 * Returns null for impossible dates.
 */
const toISO = (y, m, d) => {
  const year = +y;
  const month = +m;
  const day = +d;
  const maxYear = new Date().getFullYear() + 10;
  if (year < 1950 || year > maxYear || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// Ordered by specificity; later patterns are ignored where an earlier one already matched.
// Patterns 1 and 2 have no trailing (?!\d): a month name right before the year is strong
// enough signal that the next 4 digits are the year even if OCR glued an ID straight
// after it with no space (e.g. "12 Oct 20266452219000000388316").
const DATE_PATTERNS = [
  // 27 Aug 2026, 27th August, 2026, 27-Aug-2026, 27 of August 2026
  {
    re: new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-\\/.,]*(?:of\\s+)?${MONTH_RE}[\\s\\-\\/.,]*(\\d{4})`, 'gi'),
    base: 3,
    parse: (m) => toISO(m[3], monthNum(m[2]), m[1]),
  },
  // August 27, 2026 / Aug 27th 2026
  {
    re: new RegExp(`(?<![a-z])${MONTH_RE}[\\s\\-\\/.]*(\\d{1,2})(?:st|nd|rd|th)?[\\s,\\-]+(\\d{4})`, 'gi'),
    base: 3,
    parse: (m) => toISO(m[3], monthNum(m[1]), m[2]),
  },
  // 2026-08-27 / 2026/08/27 / 2026.08.27
  {
    re: /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g,
    base: 3,
    parse: (m) => toISO(m[1], m[2], m[3]),
  },
  // 27/08/2026, 27-08-2026, 27.08.2026: day-first (India/UK) unless that is impossible
  {
    re: /(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)/g,
    base: 2,
    parse: (m) => (+m[2] > 12 && +m[1] <= 12 ? toISO(m[3], m[1], m[2]) : toISO(m[3], m[2], m[1])),
  },
  // August 2026 (no day: assume the 1st, lowest confidence)
  {
    re: new RegExp(`(?<![a-z])${MONTH_RE}[\\s,]+(\\d{4})(?!\\d)`, 'gi'),
    base: 1,
    parse: (m) => toISO(m[2], monthNum(m[1]), 1),
  },
];

/**
 * All valid dates on a line, as { iso, start, end, base }, without overlaps.
 */
const findDatesInLine = (line) => {
  const found = [];
  for (const { re, base, parse } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      const iso = parse(m);
      if (iso) found.push({ iso, start, end, base });
    }
  }
  return found.sort((a, b) => a.start - b.start);
};

const ISSUE_CTX_RE = /\b(?:issued?|issue\s*date|date\s*of\s*(?:issue|award|completion)|dated|awarded|granted|conferred|completed|completion|achieved|earned|given)\b/i;
const DATE_LABEL_RE = /\bdate\b/i;
const NOT_ISSUE_CTX_RE = /\b(?:expir\w*|valid\s*(?:until|till|thru|through|to|upto|up\s*to)|renew\w*|birth|dob|d\.o\.b)\b/i;

const pickIssueDate = (lines, datesByLine) => {
  let best = null;

  lines.forEach((line, li) => {
    const dates = datesByLine[li];
    // A label on the previous line only counts if that line has no date of its own
    const prev = li > 0 && datesByLine[li - 1].length === 0 ? lines[li - 1] : '';

    dates.forEach((d, di) => {
      const before = line.slice(di > 0 ? dates[di - 1].end : 0, d.start);
      let score = d.base;

      if (NOT_ISSUE_CTX_RE.test(before)) score -= 10;
      else if (NOT_ISSUE_CTX_RE.test(prev)) score -= 6;
      // Second date of a validity range: "Valid from X to Y"
      if (di > 0 && /^\s*(?:to|until|till|thru|through|-)\s*$/i.test(before) && /valid|expir/i.test(line)) score -= 10;

      if (ISSUE_CTX_RE.test(before)) score += 6;
      else if (ISSUE_CTX_RE.test(prev)) score += 4;
      if (DATE_LABEL_RE.test(before)) score += 3;
      else if (DATE_LABEL_RE.test(prev)) score += 2;

      if (!best || score > best.score) best = { value: d.iso, score };
    });
  });

  return best;
};

// ─────────────────────── Certificate ID ───────────────────────

const ID_WORDS = '(?:certificate|certification|cert|credential|licen[cs]e|registration|reg|serial|reference|ref|verification|enrol{1,2}ment|roll|award|document|unique|membership|student)';
const ID_SUFFIX = '(?:id|[l1|]d|no|number|num|code)';
const ID_LABEL_RE = new RegExp(
  `\\b(?:${ID_WORDS}\\.?\\s*${ID_SUFFIX}\\b\\.?|${ID_WORDS}\\s*#|credential\\b|serial\\b|id\\b|s\\.?\\s*no\\b\\.?)\\s*[:#\\-]?\\s*`,
  'gi'
);
const URL_RE = /(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\/\S+/gi;
const PHONE_CTX_RE = /\b(?:phone|mobile|mob|tel|telephone|contact|fax|pin\s*code|zip)\b|\+\d/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cleanToken = (t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');

/**
 * Blank out index ranges in a string (replace with spaces, keeping positions stable).
 * Used to strip matched dates out of a line before looking for IDs, so a date glued
 * straight onto an ID with no space (common OCR artifact) doesn't merge into one token.
 */
const blankRanges = (line, ranges) =>
  ranges.reduce((out, r) => out.slice(0, r.start) + ' '.repeat(r.end - r.start) + out.slice(r.end), line);

const isIdLike = (token) =>
  token.length >= 4 &&
  token.length <= 64 &&
  /\d/.test(token) &&
  /^[A-Za-z0-9][A-Za-z0-9\-/_.]*$/.test(token) &&
  !/^\d{4}$/.test(token) &&
  findDatesInLine(token).length === 0;

const idFromUrl = (url) => {
  const cleaned = url.replace(/[).,;'"]+$/, '');
  const query = cleaned.match(/[?&](?:id|cert\w*|credential\w*|code|verify\w*)=([^&#\s]+)/i);
  if (query && isIdLike(cleanToken(query[1]))) return cleanToken(query[1]);
  const segments = cleaned.split(/[?#]/)[0].split('/').filter(Boolean);
  const last = cleanToken(segments[segments.length - 1] || '');
  return segments.length > 1 && isIdLike(last) ? last : null;
};

const pickCertificateId = (lines, datesByLine) => {
  const candidates = [];
  const add = (value, score) => candidates.push({ value: value.toUpperCase(), score });

  lines.forEach((line, li) => {
    // 1. Labelled: "Certificate ID: ABC-123", "Credential No. 12345", value possibly on the next line
    ID_LABEL_RE.lastIndex = 0;
    let m;
    while ((m = ID_LABEL_RE.exec(line)) !== null) {
      if (m[0].length === 0) { ID_LABEL_RE.lastIndex++; continue; }
      const rest = line.slice(m.index + m[0].length).trim();
      const token = cleanToken(rest.split(/\s+/)[0] || '');
      if (isIdLike(token)) add(token, 10);
      else if (!rest && lines[li + 1]) {
        const next = cleanToken(lines[li + 1].split(/\s+/)[0]);
        if (isIdLike(next)) add(next, 9);
      }
    }

    // 2. Verification URLs: ".../verify/UC-1234", "...?credentialId=ABC123"
    const urls = line.match(URL_RE) || [];
    for (const url of urls) {
      const id = idFromUrl(url);
      if (id) add(id, 7);
    }

    // 3. Unlabelled tokens that look like IDs
    const lineNoDates = blankRanges(line, datesByLine[li]);
    const lineWithoutUrls = urls.reduce((l, u) => l.replace(u, ' '), lineNoDates);
    for (const raw of lineWithoutUrls.split(/\s+/)) {
      if (raw.includes('@')) continue;
      const token = cleanToken(raw);
      if (token.length < 6 || !isIdLike(token)) continue;

      let score;
      if (UUID_RE.test(token)) score = 6;
      else if (/^\d+$/.test(token)) score = token.length >= 10 ? 5 : 2;
      else if (/[A-Za-z]/.test(token) && (token.match(/\d/g) || []).length >= 2) score = /[-_/]/.test(token) ? 5 : 3;
      else continue;

      if (PHONE_CTX_RE.test(line)) score -= 6;
      if (datesByLine[li].length > 0) score += 1;
      add(token, score);
    }
  });

  return candidates.reduce((best, c) => (!best || c.score > best.score ? c : best), null);
};

// ─────────────────────── Recipient Name ───────────────────────

const NAME_INTRO_RE = /(?:\bthis\s+is\s+to\s+certify\s+that|\bthis\s+certifies\s+that|\bhereby\s+certif(?:y|ies)\s+that|\bcertif(?:y|ies)\s+that|\b(?:is\s+)?(?:proudly\s+|hereby\s+)?(?:presented|awarded|granted|issued|given)\s+to|\bconferred\s+(?:up)?on|\bbestowed\s+(?:up)?on|\bcongratulations|\b(?:recipient|participant|student|candidate|awardee|holder|learner)(?:'?s)?\s+name|\bname\s+of\s+(?:the\s+)?(?:recipient|participant|student|candidate)|^name)\s*[:\-,]?\s*/i;

const COMPLETION_RE = /\b(?:has|have)\s+(?:successfully\s+)?(?:completed|participated|attended|achieved|passed|earned|demonstrated|fulfilled|cleared|been)\b|\bsuccessfully\b|\bfor\s+(?:successfully|completing|the\s+completion|participat\w*|outstanding|excellence|his|her|their|active|attending)\b|\bcompleting\b|\bparticipat(?:ed|ion)\s+in\b/i;

const SIGNATORY_RE = /\b(?:founder|co-?founder|ceo|cto|coo|director|president|principal|dean|registrar|chairman|chairperson|coordinator|instructor|trainer|mentor|manager|head|chief|officer|secretary|signature|signatory|authori[sz]ed|vp)\b/i;

const HONORIFIC_RE = /^(?:mr|mrs|ms|miss|mx|dr|prof|shri|smt|sri|kumari|km)\.?\s+/i;

// Words that never appear in a person's name on a certificate
const STOPWORDS = new Set(`
  certificate certificates certification certifications certified certify certifies completion complete completed
  achievement achievements participation appreciation excellence merit honor honour award awarded awards presented
  present recognition course courses program programme training workshop internship bootcamp webinar seminar
  conference hackathon competition contest university institute institution college school academy education
  foundation company corporation corp pvt private ltd limited inc llc llp technologies technology solutions services
  systems group department board council society association club team director founder ceo manager president
  principal dean head chief officer coordinator instructor trainer mentor signature signed authorized authorised
  signatory date issued issue valid validity expiry expires id number serial credential verify verification online
  digital professional associate specialist specialization developer advanced beginner intermediate fundamentals
  introduction basics requirements organizational successfully hereby this that the is to of and for with has have
  in on at by from an congratulations name recipient participant student candidate grade score marks hours level
  module project powered official
`.trim().split(/\s+/));

const NAME_SHAPE_RE = /^\p{L}[\p{L}.'-]*(?:\s+\p{L}[\p{L}.'-]*){0,4}$/u;

/**
 * Strip trailing sentence text, honorifics and noise from a name candidate.
 * Returns { name, hadCompletionTail }.
 */
const cleanName = (text) => {
  const tail = text.match(/\s+(?:has|have|had|for|who|from|on|in|with|is|was|successfully|s\/o|d\/o|w\/o|son|daughter|bearing|having)\b.*$/i);
  let name = tail ? text.slice(0, tail.index) : text;
  name = name
    .replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, '')
    .replace(HONORIFIC_RE, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,]+$/, '')
    .trim();
  return { name, hadCompletionTail: !!tail && COMPLETION_RE.test(tail[0]) };
};

const looksLikeName = (name) => {
  if (name.length < 3 || name.length > 60 || !NAME_SHAPE_RE.test(name)) return false;
  const words = name.split(' ');
  if (!words.some((w) => w.replace(/\./g, '').length >= 2)) return false;
  return !words.some((w) => STOPWORDS.has(w.toLowerCase().replace(/[.'-]/g, '')));
};

const isTitleCase = (name) => name.split(' ').every((w) => /^\p{Lu}/u.test(w));
const isAllCaps = (name) => name === name.toUpperCase() && name !== name.toLowerCase();

const pickRecipientName = (lines, datesByLine) => {
  let best = null;
  const consider = (name, score) => {
    if (!best || score > best.score) best = { value: name, score };
  };

  lines.forEach((line, li) => {
    // 1. Introduced: "This is to certify that John Smith", "Presented to" followed by the name on the next line
    const intro = line.match(NAME_INTRO_RE);
    if (intro) {
      const sameLine = cleanName(line.slice(intro.index + intro[0].length)).name;
      const following = [lines[li + 1], lines[li + 2]].map((l) => (l ? cleanName(l).name : ''));
      const options = [[sameLine, 12], [following[0], 11], [following[1], 9]];
      for (const [name, score] of options) {
        if (name && looksLikeName(name)) {
          consider(name, name.includes(' ') ? score : score - 3);
          break;
        }
      }
    }

    // 2. Any line that is shaped like a name, scored by its surroundings
    const { name, hadCompletionTail } = cleanName(line);
    if (!looksLikeName(name)) return;

    let score = name.includes(' ') ? 3 : -2;
    if (isTitleCase(name)) score += 2;
    else if (isAllCaps(name)) score += 1;
    if (hadCompletionTail) score += 5;
    if (lines[li + 1] && COMPLETION_RE.test(lines[li + 1])) score += 6;
    if (datesByLine[li + 1] && datesByLine[li + 1].length > 0) score += 2;
    if ((lines[li - 1] && SIGNATORY_RE.test(lines[li - 1])) || (lines[li + 1] && SIGNATORY_RE.test(lines[li + 1]))) score -= 8;

    if (score >= 3) consider(name, score);
  });

  return best;
};

const formatName = (name) =>
  isAllCaps(name) || name === name.toLowerCase()
    ? name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase())
    : name;

// ─────────────────────────── Parsing ───────────────────────────

/**
 * Parse one text into scored fields: { field: { value, score } | null }.
 */
const parseScored = (rawText) => {
  const lines = toLines(rawText);
  const datesByLine = lines.map(findDatesInLine);
  return {
    recipientName: pickRecipientName(lines, datesByLine),
    issueDate: pickIssueDate(lines, datesByLine),
    certificateId: pickCertificateId(lines, datesByLine),
  };
};

/**
 * Parse one or more texts (e.g. several OCR passes) and keep the
 * highest-scoring value for each field.
 */
const parseFields = (texts) => {
  const passes = (Array.isArray(texts) ? texts : [texts]).map(parseScored);
  const bestOf = (field) =>
    passes.map((p) => p[field]).filter(Boolean).reduce((a, b) => (b.score > a.score ? b : a), { value: null, score: -Infinity }).value;

  const name = bestOf('recipientName');
  return {
    recipientName: name ? formatName(name) : null,
    issueDate: bestOf('issueDate'),
    certificateId: bestOf('certificateId'),
  };
};

const extractCertData = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  let texts;

  if (ext === '.pdf') {
    const text = await extractFromPDF(filePath);
    if (text.replace(/\s/g, '').length < 20) {
      const err = new Error('This PDF has no selectable text (it is probably a scanned image). Upload it as a JPG or PNG instead.');
      err.userFacing = true;
      throw err;
    }
    texts = [text];
  } else if (IMAGE_EXTS.includes(ext)) {
    texts = await extractFromImage(filePath);
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  const rawText = texts.join('\n\n');

  console.log('\n========== RAW EXTRACTED TEXT ==========');
  console.log(JSON.stringify(rawText));
  console.log('=========================================\n');

  const parsed = parseFields(texts);

  console.log('========== PARSED FIELDS ==========');
  console.log(parsed);
  console.log('====================================\n');

  return { rawText, ...parsed };
};

module.exports = extractCertData;
module.exports.parseFields = parseFields;
