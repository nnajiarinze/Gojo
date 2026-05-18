import type { CanonicalReceipt } from './types';
import type { ParsedLineItem, ParsedReceipt } from './parser';

export function toLegacyParsedReceipt(receipt: CanonicalReceipt): ParsedReceipt {
  const currency = receipt.transaction.currency.value === 'SEK' ? 'SEK' : 'SEK';
  const totalAmount = receipt.transaction.total.value ?? 0;
  const vat = receipt.tax.totalTax.value;
  const subtotal = receipt.transaction.subtotal?.value ?? (vat !== null ? roundMoney(totalAmount - vat) : totalAmount);

  return {
    merchantName: receipt.merchant.name.value ?? '',
    currency,
    subtotal,
    vat,
    totalAmount,
    lineItems: receipt.lineItems.map(toLegacyLineItem),
    kontrollenhet: receipt.fiscal.controlUnit?.value ?? receipt.fiscal.fiscalId?.value ?? '',
    merchantLegalInfo: {
      companyName: receipt.merchant.legalName?.value ?? receipt.merchant.name.value ?? '',
      orgNumber: receipt.merchant.orgNumber?.value ?? '',
      address: receipt.merchant.address?.value ?? '',
    },
    confidence: receipt.validation.overallConfidence,
    debug: {
      classifiedLines: [],
      skippedLines: [],
      warnings: receipt.validation.flags,
      vatSource: vat !== null ? 'receipt' : 'missing',
      durationMs: receipt.provenance.durationMs,
    },
  };
}

function toLegacyLineItem(item: CanonicalReceipt['lineItems'][number]): ParsedLineItem {
  const quantity = item.quantity.value || 1;
  const total = item.total.value ?? 0;
  return {
    description: item.description.value,
    quantity,
    unitPrice: item.unitPrice.value ?? roundMoney(total / quantity),
    total,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
