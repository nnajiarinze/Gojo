import { parseSwedishPrice } from './normalize';
import { CURRENCY_SYMBOLS, FISCAL_TERMS, PAYMENT_TERMS, SUBTOTAL_TERMS, TAX_TERMS, TOTAL_TERMS, termsFor } from './dictionaries';
import type { Candidate, OcrDocument, OcrLine, ReceiptLineItem, TaxLine } from './types';

const DATE_PATTERNS = [
  /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
  /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/,
];
const TIME_PATTERN = /\b([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/;
const MONEY_PATTERN = /(?:^|\s)([-+]?\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{2})|[-+]?\d+[,.]\d{2})(?:\s*(?:sek|nok|dkk|eur|usd|gbp|kr|€|\$|£))?(?=\s|$)/gi;
const INTEGER_MONEY_PATTERN = /(?:^|\s)([-+]?\d{1,6})(?:\s*(?:sek|nok|dkk|eur|usd|gbp|kr|€|\$|£))?(?=\s|$)/gi;
const RATE_PATTERN = /(\d{1,2}(?:[,.]\d+)?)\s*%/;
const ORG_NUMBER_PATTERN = /(?:org\.?\s*(?:nr|nummer)?|organisationsnummer|vat\s*no|vat\s*number|company\s*no)\s*[:#-]?\s*([A-Z]{0,3}\s*\d[\d\s-]{5,})/i;
const RECEIPT_NUMBER_PATTERN = /(?:receipt\s*(?:no|number)|kvitto\s*(?:nr|nummer)|faktura\s*(?:nr|nummer)|invoice\s*(?:no|number))\s*[:#-]?\s*([A-Z0-9-]+)/i;

export interface ExtractedCandidates {
  merchants: Candidate<string>[];
  dates: Candidate<string>[];
  times: Candidate<string>[];
  currencies: Candidate<string>[];
  totals: Candidate<number>[];
  subtotals: Candidate<number>[];
  taxes: Candidate<{ amount: number; rate: number | null; base: number | null; label?: string }>[];
  lineItems: Candidate<ReceiptLineItem>[];
  paymentMethods: Candidate<string>[];
  fiscalIds: Candidate<string>[];
  orgNumbers: Candidate<string>[];
  addresses: Candidate<string>[];
  receiptNumbers: Candidate<string>[];
}

export function extractCandidates(document: OcrDocument): ExtractedCandidates {
  const lines = document.pages.flatMap((page) => page.lines);
  return {
    merchants: extractMerchantCandidates(lines),
    dates: extractDateCandidates(lines),
    times: extractTimeCandidates(lines),
    currencies: extractCurrencyCandidates(lines),
    totals: extractMoneyCandidates(lines, 'total', termsFor(TOTAL_TERMS, document.detectedLanguage)),
    subtotals: extractMoneyCandidates(lines, 'subtotal', termsFor(SUBTOTAL_TERMS, document.detectedLanguage)),
    taxes: extractTaxCandidates(lines, termsFor(TAX_TERMS, document.detectedLanguage)),
    lineItems: extractLineItemCandidates(lines),
    paymentMethods: extractKeywordCandidates(lines, 'payment_method', termsFor(PAYMENT_TERMS, document.detectedLanguage)),
    fiscalIds: extractFiscalCandidates(lines, termsFor(FISCAL_TERMS, document.detectedLanguage)),
    orgNumbers: extractOrgNumberCandidates(lines),
    addresses: extractAddressCandidates(lines),
    receiptNumbers: extractReceiptNumberCandidates(lines),
  };
}

function extractMerchantCandidates(lines: OcrLine[]): Candidate<string>[] {
  return lines.slice(0, Math.min(lines.length, 20)).flatMap((line, index) => {
    const text = line.text.trim();
    if (!text || hasMoney(text) || looksLikeDate(text) || text.length < 2 || text.length > 48) return [];
    if (looksLikeLineItemText(text) || isSummaryOrMetadata(line.normalizedText) || isCardOrContactMetadata(line.normalizedText)) return [];
    if (/^(kvitto|receipt|invoice|faktura|total|summa|kopia)$/i.test(text)) return [];
    if (/\b(aff[aä]rsid[eé]|billigaste|matkasse|v[aå]r\s+)/i.test(line.normalizedText)) return [];
    if (/\b(bord|table)\b/i.test(line.normalizedText)) return [];
    const duplicateBoost = lines.some((other, otherIndex) => otherIndex !== index && other.text.trim().toLowerCase() === text.toLowerCase()) ? 0.15 : 0;
    const score = clamp(0.85 - index * 0.03 + (/[a-zåäöéü]{3,}/i.test(text) ? 0.1 : 0) + duplicateBoost);
    return [candidate(text, 'merchant', score, line, ['early non-monetary header line'])];
  });
}

function extractDateCandidates(lines: OcrLine[]): Candidate<string>[] {
  const results: Candidate<string>[] = [];
  for (const line of lines) {
    for (const pattern of DATE_PATTERNS) {
      const match = pattern.exec(line.text);
      if (!match) continue;
      const parsed = normalizeDate(match[0]);
      if (parsed) results.push(candidate(parsed, 'date', 0.9, line, ['date pattern match']));
    }
  }
  return results;
}

function extractTimeCandidates(lines: OcrLine[]): Candidate<string>[] {
  return lines.flatMap((line) => {
    const match = TIME_PATTERN.exec(line.text);
    return match ? [candidate(match[0].replace('.', ':'), 'time', 0.85, line, ['time pattern match'])] : [];
  });
}

function extractCurrencyCandidates(lines: OcrLine[]): Candidate<string>[] {
  const text = lines.map((line) => line.normalizedText).join('\n');
  const found = CURRENCY_SYMBOLS.flatMap(({ currency, symbols }) => {
    const count = symbols.reduce((sum, symbol) => sum + (text.includes(symbol.toLowerCase()) ? 1 : 0), 0);
    return count > 0 ? [{ currency, count }] : [];
  }).sort((a, b) => b.count - a.count);

  if (found.length > 0) {
    const firstLine = lines[0];
    return [candidate(found[0].currency, 'currency', 0.8, firstLine, ['currency symbol or code detected'])];
  }

  const fallbackLine = lines[0];
  return fallbackLine ? [candidate('SEK', 'currency', 0.35, fallbackLine, ['default currency fallback'])] : [];
}

function extractMoneyCandidates(lines: OcrLine[], type: 'total' | 'subtotal', terms: string[]): Candidate<number>[] {
  const results: Candidate<number>[] = [];
  lines.forEach((line, index) => {
    const termHit = terms.some((term) => line.normalizedText.includes(term));
    if (type === 'total' && isItemCountLine(line.normalizedText)) return;
    const amounts = extractAmounts(line.text, termHit && !isItemCountLine(line.normalizedText));
    const nextLine = lines[index + 1];
    if (!termHit && type === 'subtotal') return;

    if (termHit && amounts.length === 0 && nextLine) {
      for (const amount of extractAmounts(nextLine.text, true)) {
        results.push({
          value: amount,
          candidateType: type,
          score: 0.78,
          evidenceLineIds: [line.id, nextLine.id],
          rawText: [line.text, nextLine.text],
          reasons: [`${type} keyword on previous line`],
        });
      }
      return;
    }

    if (amounts.length === 0) return;

    const positionBoost = type === 'total' ? index / Math.max(lines.length, 1) * 0.25 : 0;
    const scoreBase = termHit ? 0.75 : 0.35;
    const reasons = termHit ? [`${type} keyword proximity`] : ['monetary amount fallback'];
    for (const amount of amounts) {
      results.push(candidate(amount, type, clamp(scoreBase + positionBoost), line, reasons));
    }
  });

  if (type === 'total' && results.length === 0) {
    const fallbackLines = lines.slice(Math.max(0, lines.length - 10));
    for (const line of fallbackLines) {
      for (const amount of extractAmounts(line.text)) {
        results.push(candidate(amount, 'total', 0.3, line, ['bottom-section monetary fallback']));
      }
    }
  }

  return sortCandidates(results);
}

function extractTaxCandidates(lines: OcrLine[], terms: string[]): Candidate<{ amount: number; rate: number | null; base: number | null; label?: string }>[] {
  const results: Candidate<{ amount: number; rate: number | null; base: number | null; label?: string }>[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const termHit = matchesTaxTerm(line.normalizedText, terms) || /\bm[o0]n?s\s*%?\b/i.test(line.normalizedText);
    if (!termHit) continue;
    const amounts = extractAmounts(line.text, true);
    const nextLine = lines[index + 1];
    if (amounts.length === 0 && nextLine) {
      const nextAmounts = extractAmounts(nextLine.text, true);
      if (nextAmounts.length > 0) {
        const afterNextLine = lines[index + 2];
        const afterNextAmounts = afterNextLine ? extractAmounts(afterNextLine.text, true) : [];
        const nextLooksLikeRate = /%/.test(line.text) || (looksLikeTaxRate(nextAmounts[0]) && afterNextAmounts.length > 0);
        const amount = nextLooksLikeRate && afterNextAmounts.length > 0 ? afterNextAmounts[afterNextAmounts.length - 1] : nextAmounts[nextAmounts.length - 1];
        const rate = nextLooksLikeRate ? nextAmounts[0] : null;
        results.push({
          value: { amount, rate, base: null, label: line.text },
          candidateType: 'tax',
          score: rate !== null ? 0.84 : 0.78,
          evidenceLineIds: afterNextLine && nextLooksLikeRate ? [line.id, nextLine.id, afterNextLine.id] : [line.id, nextLine.id],
          rawText: afterNextLine && nextLooksLikeRate ? [line.text, nextLine.text, afterNextLine.text] : [line.text, nextLine.text],
          reasons: [rate !== null ? 'tax keyword with split rate and amount' : 'tax keyword on previous line'],
        });
      }
      continue;
    }
    if (amounts.length === 0) continue;
    const rateMatch = RATE_PATTERN.exec(line.text);
    const rate = rateMatch ? parseFloat(rateMatch[1].replace(',', '.')) : null;
    const amount = amounts[amounts.length - 1];
    const base = amounts.length > 1 ? amounts[0] : null;
    results.push(candidate({ amount, rate, base, label: line.text }, 'tax', clamp(0.75 + (rate !== null ? 0.1 : 0)), line, ['tax keyword proximity']));
  }
  return sortCandidates(results);
}

function extractLineItemCandidates(lines: OcrLine[]): Candidate<ReceiptLineItem>[] {
  const results: Candidate<ReceiptLineItem>[] = [];
  const separatedItems = extractSeparatedLineItemCandidates(lines);
  results.push(...separatedItems);
  if (separatedItems.length === 0) results.push(...extractSequentialNamePriceCandidates(lines));
  for (const line of lines) {
    const amounts = extractAmounts(line.text, false);
    if (amounts.length === 0 || isSummaryOrMetadata(line.normalizedText) || isCardOrContactMetadata(line.normalizedText)) continue;
    const textWithoutAmounts = stripAmounts(line.text).replace(/\s+/g, ' ').trim();
    if (textWithoutAmounts.length < 2 || !/[a-zåäöéü]/i.test(textWithoutAmounts)) continue;

    const quantityMatch = /(?:^|\s)(\d+(?:[,.]\d+)?)\s*[x×]/i.exec(line.text);
    const quantity = quantityMatch ? parseFloat(quantityMatch[1].replace(',', '.')) : 1;
    const total = amounts[amounts.length - 1];
    const unitPrice = quantity > 0 && Math.abs(total / quantity - total) > 0.01 ? roundMoney(total / quantity) : null;
    const item: ReceiptLineItem = {
      description: field(textWithoutAmounts.replace(/^\d+\s*[x×]\s*/i, '').trim(), 0.65, line, 'rules', ['line item text with amount']),
      quantity: field(quantity, quantityMatch ? 0.8 : 0.45, line, 'rules', [quantityMatch ? 'explicit quantity' : 'default quantity']),
      unitPrice: field(unitPrice, unitPrice !== null ? 0.55 : 0.25, line, 'rules', [unitPrice !== null ? 'derived from total/quantity' : 'not present']),
      total: field(total, 0.7, line, 'rules', ['rightmost monetary amount']),
    };
    results.push(candidate(item, 'line_item', 0.55, line, ['line with description and amount']));
  }
  return results;
}

function extractKeywordCandidates<T extends 'payment_method'>(lines: OcrLine[], type: T, terms: string[]): Candidate<string>[] {
  return lines.flatMap((line) => terms.some((term) => line.normalizedText.includes(term))
    ? [candidate(line.text, type, 0.7, line, ['keyword match'])]
    : []);
}

function extractFiscalCandidates(lines: OcrLine[], terms: string[]): Candidate<string>[] {
  return lines.flatMap((line, index) => {
    const hit = terms.some((term) => line.normalizedText.includes(term));
    if (!hit) return [];
    const value = line.text.split(/[:\-]/).slice(1).join('-').trim() || lines[index + 1]?.text?.trim() || line.text;
    return [candidate(value, 'fiscal_id', 0.75, line, ['fiscal keyword match'])];
  });
}

function extractOrgNumberCandidates(lines: OcrLine[]): Candidate<string>[] {
  return lines.flatMap((line, index) => {
    const match = ORG_NUMBER_PATTERN.exec(line.text);
    if (match) return [candidate(match[1].replace(/\s+/g, ' ').trim(), 'org_number', 0.85, line, ['organization number pattern'])];
    if (/\b(org\.?\s*(?:nr|nummer)?|organisationsnummer)\b/i.test(line.text)) {
      const nextLine = lines[index + 1];
      const nextValue = nextLine?.text.trim();
      if (nextValue && looksLikeOrganizationNumber(nextValue)) {
        return [candidate(nextValue.replace(/\s+/g, ' ').trim(), 'org_number', 0.78, nextLine, ['organization number label on previous line'])];
      }
    }
    return [];
  });
}

function extractAddressCandidates(lines: OcrLine[]): Candidate<string>[] {
  return lines.flatMap((line) => {
    const text = line.text.trim();
    const hasPostalCodeWithPlace = /\b\d{3}\s?\d{2}\b/.test(text) && /[a-zåäöéü]{3,}/i.test(text);
    const hasStreetWord = /\b(gatan|gata|vägen|vagen|street|road|st\.|ave|avenue)\b/i.test(text);
    const looksLikeAddress = hasPostalCodeWithPlace || hasStreetWord;
    if (!looksLikeAddress || hasMoney(text) || text.length > 80 || isCardOrContactMetadata(line.normalizedText)) return [];
    return [candidate(text, 'address', 0.7, line, ['address-like text pattern'])];
  });
}

function extractSequentialNamePriceCandidates(lines: OcrLine[]): Candidate<ReceiptLineItem>[] {
  const priceStart = lines.findIndex((line) => isStandalonePriceLine(line.text));
  if (priceStart <= 0) return [];

  const sectionStart = findLikelyItemSectionStart(lines, priceStart);
  const itemLines = lines
    .slice(sectionStart, priceStart)
    .filter((line) => isProductNameLine(line));
  const priceRows: Array<{ line: OcrLine; total: number }> = [];

  for (const line of lines.slice(priceStart)) {
    if (isSummaryOrMetadata(line.normalizedText) || isCardOrContactMetadata(line.normalizedText)) break;
    if (/\bslut\b/i.test(line.normalizedText)) break;
    if (!isStandalonePriceLine(line.text)) break;
    const amounts = extractAmounts(line.text, false);
    if (amounts.length === 1) priceRows.push({ line, total: amounts[0] });
  }

  const count = Math.min(itemLines.length, priceRows.length);
  if (count < 3) return [];

  const results: Candidate<ReceiptLineItem>[] = [];
  for (let index = 0; index < count; index++) {
    const itemLine = itemLines[index];
    const priceRow = priceRows[index];
    const item: ReceiptLineItem = {
      description: field(itemLine.text.trim(), 0.72, itemLine, 'rules', ['sequential product name before price block']),
      quantity: field(1, 0.45, itemLine, 'rules', ['default quantity for separated grocery item']),
      unitPrice: field(priceRow.total, 0.6, priceRow.line, 'rules', ['single separated price used as unit price']),
      total: field(priceRow.total, 0.76, priceRow.line, 'rules', ['paired sequential price line']),
    };
    results.push({
      value: item,
      candidateType: 'line_item',
      score: 0.76,
      evidenceLineIds: [itemLine.id, priceRow.line.id],
      rawText: [itemLine.text, priceRow.line.text],
      reasons: ['paired product-name block with following price block'],
    });
  }
  return results;
}

function findLikelyItemSectionStart(lines: OcrLine[], priceStart: number): number {
  const startIndex = lines
    .slice(0, priceStart)
    .findIndex((line) => /\bstart\b/i.test(line.normalizedText));
  if (startIndex >= 0) return startIndex + 1;

  const markerIndex = lines
    .slice(0, priceStart)
    .findIndex((line) => /\b(sj[aä]lvscanning|self[- ]?scanning)\b/i.test(line.normalizedText));
  return markerIndex >= 0 ? markerIndex + 1 : Math.max(0, priceStart - 25);
}

function isProductNameLine(line: OcrLine): boolean {
  const text = line.text.trim();
  if (text.length < 3 || text.length > 56) return false;
  if (!/[a-zåäöéü]/i.test(text)) return false;
  if (hasMoney(text) || looksLikeDate(text) || isSummaryOrMetadata(line.normalizedText) || isCardOrContactMetadata(line.normalizedText)) return false;
  if (/\b(start|slut|sj[aä]lvscanning|self[- ]?scanning|vinsta|aff[aä]rsid[eé])\b/i.test(line.normalizedText)) return false;
  return true;
}

function looksLikeLineItemText(text: string): boolean {
  return /^\d+(?:[,.]\d+)?\s*[x×]\s+\S+/i.test(text.trim());
}

function looksLikeOrganizationNumber(text: string): boolean {
  const compact = text.replace(/\D/g, '');
  return /^\d{6}-?\d{4}$/.test(text.trim()) || compact.length === 10;
}

function isStandalonePriceLine(text: string): boolean {
  return /^[-+]?\d{1,4}[,.]\d{2}$/.test(text.trim());
}

function extractSeparatedLineItemCandidates(lines: OcrLine[]): Candidate<ReceiptLineItem>[] {
  const totalIndex = lines.findIndex((line) => /^totalt$/i.test(line.text.trim()));
  if (totalIndex <= 0) return [];

  const itemLines = lines
    .slice(0, totalIndex)
    .filter((line) => /^\d+(?:[,.]\d+)?\s*[x×]\s+\S+/i.test(line.text.trim()));
  const priceLines = lines
    .slice(totalIndex + 1)
    .filter((line) => !isSummaryOrMetadata(line.normalizedText) && !isCardOrContactMetadata(line.normalizedText))
    .flatMap((line) => extractSeparatedPrice(line).map((price) => ({ line, price })));

  const count = Math.min(itemLines.length, priceLines.length);
  const results: Candidate<ReceiptLineItem>[] = [];
  for (let index = 0; index < count; index++) {
    const itemLine = itemLines[index];
    const priceLine = priceLines[index];
    const match = /^(\d+(?:[,.]\d+)?)\s*[x×]\s+(.+)$/i.exec(itemLine.text.trim());
    if (!match) continue;
    const quantity = parseFloat(match[1].replace(',', '.')) || 1;
    const description = match[2].trim();
    const unitPrice = priceLine.price.unitPrice ?? (quantity > 0 ? roundMoney(priceLine.price.total / quantity) : null);
    const item: ReceiptLineItem = {
      description: field(description, 0.78, itemLine, 'rules', ['separated item line before TOTALT']),
      quantity: field(quantity, 0.85, itemLine, 'rules', ['explicit quantity']),
      unitPrice: field(unitPrice, unitPrice !== null ? 0.75 : 0.35, priceLine.line, 'rules', ['paired separated price line']),
      total: field(priceLine.price.total, 0.82, priceLine.line, 'rules', ['paired separated price line']),
    };
    results.push({
      value: item,
      candidateType: 'line_item',
      score: 0.82,
      evidenceLineIds: [itemLine.id, priceLine.line.id],
      rawText: [itemLine.text, priceLine.line.text],
      reasons: ['paired item list with price block after TOTALT'],
    });
  }

  return results;
}

function extractSeparatedPrice(line: OcrLine): Array<{ unitPrice: number | null; total: number }> {
  const text = line.text.trim();
  const unitAndTotal = /\(\s*[aáà]\s*([\d\s.,]+)\s*\)\s+([\d\s.,]+)/i.exec(text);
  if (unitAndTotal) {
    const unitPrice = parseFlexibleMoney(unitAndTotal[1]);
    const total = parseFlexibleMoney(unitAndTotal[2]);
    return total !== null ? [{ unitPrice, total }] : [];
  }
  if (/^\(\s*[aáà]\s*[\d\s.,]+\s*\)$/i.test(text)) return [];
  const amounts = extractAmounts(text, false);
  return amounts.length === 1 ? [{ unitPrice: null, total: amounts[0] }] : [];
}

function extractReceiptNumberCandidates(lines: OcrLine[]): Candidate<string>[] {
  return lines.flatMap((line) => {
    const match = RECEIPT_NUMBER_PATTERN.exec(line.text);
    return match ? [candidate(match[1].trim(), 'receipt_number', 0.8, line, ['receipt number pattern'])] : [];
  });
}

export function field<T>(value: T, confidence: number, line: OcrLine | null, strategy: 'rules' | 'legacy' | 'local_llm' | 'local_ml' | 'hybrid' | 'manual', notes: string[] = []) {
  return {
    value,
    confidence: clamp(confidence),
    evidence: {
      ocrLineIds: line ? [line.id] : [],
      rawText: line ? [line.text] : [],
      strategy,
      confidence: clamp(confidence),
      notes,
    },
  };
}

function candidate<T>(value: T, candidateType: Candidate<T>['candidateType'], score: number, line: OcrLine, reasons: string[]): Candidate<T> {
  return { value, candidateType, score: clamp(score), evidenceLineIds: [line.id], rawText: [line.text], reasons };
}

function extractAmounts(text: string, allowIntegerWithCurrency = false): number[] {
  MONEY_PATTERN.lastIndex = 0;
  const amounts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = MONEY_PATTERN.exec(text)) !== null) {
    const parsed = parseFlexibleMoney(match[1]);
    if (parsed !== null) amounts.push(parsed);
  }
  if (allowIntegerWithCurrency) {
    INTEGER_MONEY_PATTERN.lastIndex = 0;
    while ((match = INTEGER_MONEY_PATTERN.exec(text)) !== null) {
      const parsed = parseFlexibleMoney(match[1]);
      if (parsed !== null) amounts.push(parsed);
    }
  }
  return amounts;
}

function stripAmounts(text: string): string {
  return text
    .replace(MONEY_PATTERN, ' ')
    .replace(INTEGER_MONEY_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFlexibleMoney(value: string): number | null {
  const swedish = parseSwedishPrice(value);
  if (swedish !== null) return swedish;
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function normalizeDate(raw: string): string | null {
  const clean = raw.replace(/[/.]/g, '-');
  const parts = clean.split('-').map((part) => part.padStart(2, '0'));
  if (parts.length !== 3) return null;
  if (parts[0].length === 4) return `${parts[0]}-${parts[1]}-${parts[2]}`;
  const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
  return `${year}-${parts[1]}-${parts[0]}`;
}

function looksLikeDate(text: string): boolean {
  return DATE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasMoney(text: string): boolean {
  return extractAmounts(text).length > 0;
}

function isSummaryOrMetadata(text: string): boolean {
  const terms = ['total', 'totalt', 'summa', 'moms', 'mons', 'vat', 'tax', 'netto', 'subtotal', 'brutto', 'visa', 'mastercard', 'receipt', 'kvitto', 'belopp', 'lopp', 'mottaget', 'kontokort'];
  return terms.some((term) => text.includes(term));
}

function isItemCountLine(text: string): boolean {
  return /\b(varor|items|artiklar|st(?:\.|ycken)?)\b/.test(text);
}

function isCardOrContactMetadata(text: string): boolean {
  const terms = ['aid', 'tvr', 'isi', 'auth', 'ref', 'kort', 'card', 'terminal', 'kontaktlos', 'contactless', 'tfn', 'tel', 'telefon', 'epost', 'email', 'www', 'kassa', 'kassor'];
  return terms.some((term) => text.includes(term));
}

function matchesTaxTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    const normalizedTerm = term.toLowerCase();
    if (normalizedTerm.length <= 3) return new RegExp(`\\b${escapeRegExp(normalizedTerm)}\\b`, 'i').test(text);
    return text.includes(normalizedTerm);
  });
}

function looksLikeTaxRate(value: number): boolean {
  return [5, 6, 10, 12, 20, 21, 22, 24, 25].some((rate) => Math.abs(value - rate) <= 0.01);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortCandidates<T>(candidates: Candidate<T>[]): Candidate<T>[] {
  return [...candidates].sort((a, b) => b.score - a.score);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
