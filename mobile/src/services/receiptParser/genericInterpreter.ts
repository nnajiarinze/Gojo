import { extractCandidates } from './candidates';
import { field } from './candidates';
import { validateCanonicalReceipt } from './validation';
import type { CanonicalReceipt, OcrDocument, ReceiptInterpreter, TaxLine } from './types';

export class RuleBasedReceiptInterpreter implements ReceiptInterpreter {
  name = 'RuleBasedReceiptInterpreter';
  version = '1.0.0';

  interpret(input: OcrDocument): CanonicalReceipt {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const candidates = extractCandidates(input);
    const firstLine = input.pages[0]?.lines[0] ?? null;

    const merchant = candidates.merchants[0];
    const date = candidates.dates[0];
    const time = candidates.times[0];
    const currency = candidates.currencies[0];
    const total = chooseTotal(candidates.totals);
    const subtotal = candidates.subtotals[0];
    const taxes = chooseTaxes(candidates.taxes, total?.value ?? null, subtotal?.value ?? null);
    const taxTotal = taxes.length > 0 ? roundMoney(taxes.reduce((sum, tax) => sum + tax.value.amount, 0)) : inferTax(total?.value ?? null, subtotal?.value ?? null);
    const lineItems = candidates.lineItems.map((candidate) => candidate.value);
    const fiscalId = candidates.fiscalIds[0];
    const payment = candidates.paymentMethods[0];
    const orgNumber = candidates.orgNumbers[0];
    const address = candidates.addresses[0];
    const receiptNumber = candidates.receiptNumbers[0];
    const completedAtMs = Date.now();

    const receipt: CanonicalReceipt = {
      id: `canonical-${input.id}`,
      documentKind: classifyDocument(input.rawText),
      merchant: {
        name: merchant
          ? field(merchant.value, merchant.score, lineFor(input, merchant.evidenceLineIds[0]), 'rules', merchant.reasons)
          : field(null, 0.2, firstLine, 'rules', ['merchant not detected']),
        legalName: merchant
          ? field(merchant.value, merchant.score, lineFor(input, merchant.evidenceLineIds[0]), 'rules', merchant.reasons)
          : field(null, 0.2, firstLine, 'rules', ['legal name not detected']),
        orgNumber: orgNumber
          ? field(orgNumber.value, orgNumber.score, lineFor(input, orgNumber.evidenceLineIds[0]), 'rules', orgNumber.reasons)
          : field(null, 0.2, firstLine, 'rules', ['organization number not detected']),
        address: address
          ? field(address.value, address.score, lineFor(input, address.evidenceLineIds[0]), 'rules', address.reasons)
          : field(null, 0.2, firstLine, 'rules', ['address not detected']),
      },
      transaction: {
        receiptNumber: receiptNumber
          ? field(receiptNumber.value, receiptNumber.score, lineFor(input, receiptNumber.evidenceLineIds[0]), 'rules', receiptNumber.reasons)
          : field(null, 0.2, firstLine, 'rules', ['receipt number not detected']),
        date: date
          ? field(date.value, date.score, lineFor(input, date.evidenceLineIds[0]), 'rules', date.reasons)
          : field(null, 0.2, firstLine, 'rules', ['date not detected']),
        time: time
          ? field(time.value, time.score, lineFor(input, time.evidenceLineIds[0]), 'rules', time.reasons)
          : field(null, 0.2, firstLine, 'rules', ['time not detected']),
        currency: currency
          ? field(currency.value, currency.score, lineFor(input, currency.evidenceLineIds[0]), 'rules', currency.reasons)
          : field('SEK', 0.3, firstLine, 'rules', ['default currency fallback']),
        subtotal: subtotal
          ? field(subtotal.value, subtotal.score, lineFor(input, subtotal.evidenceLineIds[0]), 'rules', subtotal.reasons)
          : field(null, 0.25, firstLine, 'rules', ['subtotal not detected']),
        total: total
          ? field(total.value, total.score, lineFor(input, total.evidenceLineIds[0]), 'rules', total.reasons)
          : field(null, 0.15, firstLine, 'rules', ['total not detected']),
        paymentMethod: payment
          ? field(payment.value, payment.score, lineFor(input, payment.evidenceLineIds[0]), 'rules', payment.reasons)
          : field(null, 0.2, firstLine, 'rules', ['payment method not detected']),
      },
      tax: {
        totalTax: taxTotal !== null
          ? field(taxTotal, taxes[0]?.score ?? 0.45, taxes[0] ? lineFor(input, taxes[0].evidenceLineIds[0]) : firstLine, 'rules', taxes[0]?.reasons ?? ['tax inferred from subtotal and total'])
          : field(null, 0.25, firstLine, 'rules', ['tax not detected']),
        lines: taxes.map((tax): TaxLine => ({
          label: tax.value.label,
          rate: field(tax.value.rate, tax.value.rate !== null ? 0.75 : 0.35, lineFor(input, tax.evidenceLineIds[0]), 'rules', ['tax rate candidate']),
          base: field(tax.value.base, tax.value.base !== null ? 0.65 : 0.3, lineFor(input, tax.evidenceLineIds[0]), 'rules', ['tax base candidate']),
          amount: field(tax.value.amount, tax.score, lineFor(input, tax.evidenceLineIds[0]), 'rules', tax.reasons),
        })),
      },
      lineItems,
      fiscal: {
        fiscalId: fiscalId
          ? field(fiscalId.value, fiscalId.score, lineFor(input, fiscalId.evidenceLineIds[0]), 'rules', fiscalId.reasons)
          : field(null, 0.2, firstLine, 'rules', ['fiscal id not detected']),
        controlUnit: fiscalId
          ? field(fiscalId.value, fiscalId.score, lineFor(input, fiscalId.evidenceLineIds[0]), 'rules', fiscalId.reasons)
          : field(null, 0.2, firstLine, 'rules', ['control unit not detected']),
      },
      validation: {
        itemSum: { passed: null, confidence: 0 },
        taxSum: { passed: null, confidence: 0 },
        subtotalTaxTotal: { passed: null, confidence: 0 },
        duplicateRisk: { passed: null, confidence: 0 },
        requiredFields: { passed: null, confidence: 0 },
        overallConfidence: 0,
        reviewRequired: true,
        flags: [],
      },
      provenance: {
        ocrDocumentId: input.id,
        parserVersion: this.version,
        strategy: 'rules',
        startedAt,
        completedAt: new Date(completedAtMs).toISOString(),
        durationMs: completedAtMs - startedAtMs,
      },
    };

    return { ...receipt, validation: validateCanonicalReceipt(receipt) };
  }
}

export function interpretReceipt(input: OcrDocument): CanonicalReceipt {
  return new RuleBasedReceiptInterpreter().interpret(input);
}

function chooseTotal(candidates: ReturnType<typeof extractCandidates>['totals']) {
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.05) return b.score - a.score;
    return b.value - a.value;
  })[0];
}

function inferTax(total: number | null, subtotal: number | null): number | null {
  if (total === null || subtotal === null || total <= subtotal) return null;
  return roundMoney(total - subtotal);
}

function chooseTaxes(candidates: ReturnType<typeof extractCandidates>['taxes'], total: number | null, subtotal: number | null) {
  const expected = inferTax(total, subtotal);
  if (expected === null) return candidates.slice(0, 1);

  const exactMatches = candidates.filter((candidate) => Math.abs(candidate.value.amount - expected) <= 0.05);
  if (exactMatches.length > 0) return exactMatches.slice(0, 1);

  const plausibleCandidates = candidates
    .filter((candidate) => candidate.value.amount > 0 && candidate.value.amount <= Math.max(expected * 1.5, expected + 5))
    .sort((a, b) => Math.abs(a.value.amount - expected) - Math.abs(b.value.amount - expected));

  return plausibleCandidates.length > 0 ? plausibleCandidates.slice(0, 1) : [];
}

function classifyDocument(text: string): CanonicalReceipt['documentKind'] {
  const normalized = text.toLowerCase();
  if (/credit|refund|återköp|retur/.test(normalized)) return 'refund';
  if (/invoice|faktura|due date|förfallodatum/.test(normalized)) return 'invoice';
  if (/visa|mastercard|auth|aid:|terminal/.test(normalized) && !/moms|mons|m[o0]n?s|vat|tax/.test(normalized)) return 'card_slip';
  if (/receipt|kvitto|total|totalt|moms|mons|m[o0]n?s|vat|tax/.test(normalized)) return 'receipt';
  return 'unknown';
}

function lineFor(input: OcrDocument, id: string | undefined) {
  return input.pages.flatMap((page) => page.lines).find((line) => line.id === id) ?? null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
