/**
 * OCR text normalization for Swedish restaurant receipts.
 *
 * Handles:
 * - whitespace cleanup
 * - Swedish decimal comma → dot for parsing
 * - common OCR misreads
 */

/** Known OCR misreads → corrections */
const OCR_CORRECTIONS: Array<[RegExp, string]> = [
  [/Gej0/gi, 'Gojo'],
  [/gojorastaurang/gi, 'gojorestaurang'],
  [/Stackho\s*lm/gi, 'Stockholm'],
  [/infotgojo/gi, 'info@gojo'],
  // Ü → Ö in Swedish words (common OCR mistake)
  [/Üppen/gi, 'Öppen'],
];

/**
 * Normalize a full OCR text block.
 */
export function normalizeOcrText(raw: string): string {
  let text = raw;

  // Collapse multiple spaces into one
  text = text.replace(/[ \t]+/g, ' ');

  // Trim each line
  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  // Apply known OCR corrections
  for (const [pattern, replacement] of OCR_CORRECTIONS) {
    text = text.replace(pattern, replacement);
  }

  return text;
}

/**
 * Parse a Swedish-formatted price string like "3 668,00" or "175,00" into a number.
 * Swedish format: dot/space for thousands, comma for decimals.
 */
export function parseSwedishPrice(raw: string): number | null {
  if (!raw) return null;

  // Remove SEK suffix/prefix
  let s = raw.replace(/SEK/gi, '').trim();

  // Remove spaces used as thousands separators: "3 668,00" → "3668,00"
  s = s.replace(/\s/g, '');

  // Remove dot used as thousands separator: "3.668,00" → "3668,00"
  // Only if comma is present (so we know dot is thousands, not decimal)
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '');
  }

  // Replace comma with dot for JS parsing
  s = s.replace(',', '.');

  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

/**
 * Normalize a single line for classification.
 */
export function normalizeLine(line: string): string {
  return line.replace(/[ \t]+/g, ' ').trim();
}
