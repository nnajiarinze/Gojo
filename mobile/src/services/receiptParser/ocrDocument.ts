import { normalizeLine, normalizeOcrText } from './normalize';
import type { OcrDocument, OcrEngine, SourceType } from './types';

export interface CreateOcrDocumentInput {
  rawText: string;
  id?: string;
  sourceType?: SourceType;
  engine?: OcrEngine;
  confidence?: number | null;
  detectedLanguage?: string | null;
  createdAt?: string;
}

export function createOcrDocument(input: CreateOcrDocumentInput): OcrDocument {
  const text = normalizeOcrText(input.rawText);
  const lines = text
    .split('\n')
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .map((line, index) => ({
      id: `line-${index + 1}`,
      text: line,
      normalizedText: normalizeForMatching(line),
      confidence: input.confidence ?? null,
    }));

  return {
    id: input.id ?? `ocr-${Date.now()}`,
    sourceType: input.sourceType ?? 'text',
    rawText: text,
    pages: [{ pageNumber: 1, lines }],
    detectedLanguage: input.detectedLanguage ?? detectReceiptLanguage(text),
    engine: input.engine ?? 'device_ocr',
    confidence: input.confidence ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function normalizeForMatching(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectReceiptLanguage(text: string): string | null {
  const normalized = normalizeForMatching(text);
  const scores: Record<string, number> = {
    sv: scoreTerms(normalized, ['moms', 'summa', 'totalt', 'kvitto', 'org nr', 'kontrollenhet', 'att betala']),
    en: scoreTerms(normalized, ['vat', 'tax', 'total', 'receipt', 'amount due', 'subtotal', 'invoice']),
    no: scoreTerms(normalized, ['mva', 'totalt', 'kvittering', 'a betale', 'sum']),
    da: scoreTerms(normalized, ['moms', 'total', 'kvittering', 'i alt', 'belob']),
    fi: scoreTerms(normalized, ['alv', 'yhteensa', 'kuitti', 'summa']),
    de: scoreTerms(normalized, ['mwst', 'gesamt', 'summe', 'rechnung', 'beleg']),
    fr: scoreTerms(normalized, ['tva', 'total', 'recu', 'montant']),
    es: scoreTerms(normalized, ['iva', 'total', 'recibo', 'importe']),
  };

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}

function scoreTerms(text: string, terms: string[]): number {
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}
