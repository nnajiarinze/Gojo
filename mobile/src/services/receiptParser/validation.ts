import type { CanonicalReceipt, ReceiptLineItem, TaxLine, ValidationFlag } from './types';

export function validateCanonicalReceipt(receipt: CanonicalReceipt): CanonicalReceipt['validation'] {
  const flags: ValidationFlag[] = [];
  const total = receipt.transaction.total.value;
  const subtotal = receipt.transaction.subtotal?.value ?? null;
  const taxTotal = receipt.tax.totalTax.value;
  const itemsSumValue = sumLineItems(receipt.lineItems);

  const itemSum = total !== null && receipt.lineItems.length > 0
    ? checkApprox(itemsSumValue, subtotal ?? total, 'Item sum does not match subtotal/total')
    : { passed: null, confidence: 0.35, message: receipt.lineItems.length === 0 ? 'No line items detected' : 'No total available' };

  const taxSumValue = sumTaxLines(receipt.tax.lines);
  const taxSum = taxTotal !== null && receipt.tax.lines.length > 0
    ? checkApprox(taxSumValue, taxTotal, 'Tax lines do not match total tax')
    : { passed: null, confidence: 0.35, message: 'Tax line reconciliation unavailable' };

  const subtotalTaxTotal = total !== null && subtotal !== null && taxTotal !== null
    ? checkApprox(subtotal + taxTotal, total, 'Subtotal plus tax does not match total')
    : { passed: null, confidence: 0.35, message: 'Subtotal/tax/total reconciliation unavailable' };

  if (total === null) flags.push('missing_total');
  if (!receipt.transaction.date.value) flags.push('missing_date');
  if (!receipt.merchant.name.value) flags.push('missing_merchant');
  if (itemSum.passed === false) flags.push('item_sum_mismatch');
  if (taxSum.passed === false || subtotalTaxTotal.passed === false) flags.push('tax_mismatch');
  if (receipt.lineItems.length === 0) flags.push('no_line_items');

  const requiredFieldsPassed = total !== null && !!receipt.merchant.name.value;
  const requiredFields = {
    passed: requiredFieldsPassed,
    confidence: requiredFieldsPassed ? 0.9 : 0.4,
    message: requiredFieldsPassed ? undefined : 'Merchant and total are required for automatic processing',
  };

  const confidenceInputs = [
    receipt.merchant.name.confidence,
    receipt.transaction.date.confidence,
    receipt.transaction.total.confidence,
    receipt.transaction.currency.confidence,
    receipt.tax.totalTax.confidence,
    itemSum.confidence,
    taxSum.confidence,
    subtotalTaxTotal.confidence,
  ];
  const validationPenalty = flags.length * 0.08;
  const overallConfidence = clamp(average(confidenceInputs) - validationPenalty);
  const reviewRequired = overallConfidence < 0.7 || flags.includes('missing_total') || flags.includes('missing_merchant');
  if (reviewRequired && !flags.includes('manual_review_required')) flags.push('manual_review_required');

  return {
    itemSum,
    taxSum,
    subtotalTaxTotal,
    duplicateRisk: { passed: null, confidence: 0.5, message: 'Duplicate check not run in local interpreter' },
    requiredFields,
    overallConfidence,
    reviewRequired,
    flags,
  };
}

function sumLineItems(items: ReceiptLineItem[]): number {
  return roundMoney(items.reduce((sum, item) => sum + (item.total.value ?? 0), 0));
}

function sumTaxLines(lines: TaxLine[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + (line.amount.value ?? 0), 0));
}

function checkApprox(actual: number, expected: number, message: string) {
  const delta = Math.abs(roundMoney(actual) - roundMoney(expected));
  const passed = delta <= 0.05 || delta / Math.max(Math.abs(expected), 1) <= 0.02;
  return {
    passed,
    confidence: passed ? 0.9 : 0.45,
    message: passed ? undefined : `${message}: ${roundMoney(actual)} vs ${roundMoney(expected)}`,
  };
}

function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length === 0 ? 0 : valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
