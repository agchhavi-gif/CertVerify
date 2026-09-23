const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const extractFromPDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
};

const extractFromImage = async (filePath) => {
  const result = await Tesseract.recognize(filePath, 'eng', { logger: () => {} });
  return result.data.text;
};

/**
 * Manually parse "27 Aug 2026" style dates that Node's Date constructor
 * cannot handle (day-first format).
 * Returns "YYYY-MM-DD" string or null.
 */
const parseDate = (str) => {
  if (!str) return null;

  const MONTH_MAP = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  // "27 Aug 2026" — day month year
  const dayMonthYear = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dayMonthYear) {
    const day = parseInt(dayMonthYear[1], 10);
    const month = MONTH_MAP[dayMonthYear[2].toLowerCase()];
    const year = parseInt(dayMonthYear[3], 10);
    if (month !== undefined) {
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    }
  }

  // "Aug 27, 2026" or "Aug 27 2026" — month day year
  const monthDayYear = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthDayYear) {
    const month = MONTH_MAP[monthDayYear[1].toLowerCase()];
    const day = parseInt(monthDayYear[2], 10);
    const year = parseInt(monthDayYear[3], 10);
    if (month !== undefined) {
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    }
  }

  // "2026-08-27" — ISO format
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  // "27/08/2026" or "08/27/2026"
  const slashed = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashed) {
    // Try DD/MM/YYYY first (common in India)
    const d = new Date(parseInt(slashed[3]), parseInt(slashed[2]) - 1, parseInt(slashed[1]));
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  return null;
};

const parseFields = (rawText) => {
  const result = {
    recipientName: null,
    issueDate: null,
    certificateId: null,
  };

  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const MONTHS_RE = /jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?/i;

  // ── Find the line that has both a date AND the cert ID ──
  // Format: "27 Aug 2026 6452219000000395001"
  // We need to split this line carefully:
  //   - Date part: tokens that form a valid date
  //   - ID part: the remaining long numeric token

  let dateLine = null;
  let dateLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Does this line contain a month name AND a long number?
    if (MONTHS_RE.test(line) && /\d{10,}/.test(line)) {
      dateLine = line;
      dateLineIndex = i;
      break;
    }
    // Or does it have a 4-digit year and a long number?
    if (/\b\d{4}\b/.test(line) && /\d{10,}/.test(line)) {
      dateLine = line;
      dateLineIndex = i;
      break;
    }
  }

  if (dateLine) {
    // Extract the long numeric ID — must be standalone (preceded by space or start)
    // The cert ID is the last token on this line
    const tokens = dateLine.split(/\s+/);

    // Find cert ID: last token that is purely digits and 10+ chars
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (/^\d{10,}$/.test(tokens[i])) {
        result.certificateId = tokens[i];
        // Remove the cert ID token from what we use for date parsing
        tokens.splice(i, 1);
        break;
      }
    }

    // Remaining tokens form the date string e.g. "27 Aug 2026"
    const dateStr = tokens.join(' ').trim();
    result.issueDate = parseDate(dateStr);
  }

  // ── Fallback cert ID search (alphanumeric like UC-123456789) ──
  if (!result.certificateId) {
    for (const line of lines) {
      const tokens = line.split(/\s+/);
      for (const token of tokens) {
        if (/^[A-Z]{2,}-[A-Z0-9\-]{4,}$/i.test(token)) {
          result.certificateId = token.trim().toUpperCase();
          break;
        }
      }
      if (result.certificateId) break;
    }
  }

  // ── Fallback date search ──
  if (!result.issueDate) {
    const datePatterns = [
      new RegExp(`(\\d{1,2}\\s+(?:${MONTHS_RE.source})\\s+\\d{4})`, 'i'),
      new RegExp(`((?:${MONTHS_RE.source})\\s+\\d{1,2},?\\s+\\d{4})`, 'i'),
      /(\d{4}-\d{2}-\d{2})/,
      /(\d{1,2}\/\d{1,2}\/\d{4})/,
    ];
    for (const pat of datePatterns) {
      const m = rawText.match(pat);
      if (m) {
        const parsed = parseDate(m[1].trim());
        if (parsed) { result.issueDate = parsed; break; }
      }
    }
  }

  // ── Recipient Name ──
  const SKIP = /concretio|salesforce|certified|developer|advanced|presented|completing|organizational|certification|requirements|founder|issue\s*date|abhinav/i;

  // Line before the date+ID line
  if (dateLineIndex > 0) {
    for (let j = dateLineIndex - 1; j >= 0; j--) {
      const candidate = lines[j];
      if (
        /^[A-Za-z][A-Za-z\s'\-]{2,59}$/.test(candidate) &&
        !SKIP.test(candidate) &&
        candidate.trim().split(/\s+/).length >= 2
      ) {
        result.recipientName = candidate.trim();
        break;
      }
    }
  }

  // Fallback: first properly-capitalized name line
  if (!result.recipientName) {
    for (const line of lines) {
      if (
        /^[A-Z][a-z]+(\s[A-Z][a-z]+)+$/.test(line) &&
        !SKIP.test(line)
      ) {
        result.recipientName = line.trim();
        break;
      }
    }
  }

  return result;
};

const extractCertData = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  let rawText = '';

  if (ext === '.pdf') {
    rawText = await extractFromPDF(filePath);
  } else if (['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp'].includes(ext)) {
    rawText = await extractFromImage(filePath);
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  console.log('\n========== RAW EXTRACTED TEXT ==========');
  console.log(JSON.stringify(rawText));
  console.log('=========================================\n');

  const parsed = parseFields(rawText);

  console.log('========== PARSED FIELDS ==========');
  console.log(parsed);
  console.log('====================================\n');

  return { rawText, ...parsed };
};

module.exports = extractCertData;
