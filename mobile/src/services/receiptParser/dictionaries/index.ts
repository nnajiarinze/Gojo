export const TOTAL_TERMS: Record<string, string[]> = {
  sv: ['totalt', 'summa', 'att betala', 'belopp', 'total'],
  en: ['total', 'grand total', 'amount due', 'balance due', 'amount paid'],
  no: ['totalt', 'a betale', 'å betale', 'sum'],
  da: ['total', 'i alt', 'belob', 'beløb'],
  fi: ['yhteensa', 'yhteensä', 'summa', 'maksettava'],
  de: ['gesamt', 'summe', 'zu zahlen', 'total'],
  fr: ['total', 'montant', 'a payer', 'à payer'],
  es: ['total', 'importe', 'a pagar'],
};

export const SUBTOTAL_TERMS: Record<string, string[]> = {
  sv: ['netto', 'subtotal', 'delsumma'],
  en: ['subtotal', 'net', 'net amount'],
  no: ['netto', 'subtotal'],
  da: ['netto', 'subtotal'],
  fi: ['netto', 'valisumma', 'välisumma'],
  de: ['netto', 'zwischensumme'],
  fr: ['sous-total', 'net'],
  es: ['subtotal', 'neto'],
};

export const TAX_TERMS: Record<string, string[]> = {
  sv: ['moms', 'varav moms'],
  en: ['vat', 'tax', 'gst', 'sales tax'],
  no: ['mva'],
  da: ['moms'],
  fi: ['alv'],
  de: ['mwst', 'ust'],
  fr: ['tva'],
  es: ['iva'],
};

export const PAYMENT_TERMS: Record<string, string[]> = {
  common: ['visa', 'mastercard', 'amex', 'card', 'kort', 'cash', 'kontant', 'swish', 'mobilepay'],
};

export const FISCAL_TERMS: Record<string, string[]> = {
  sv: ['kontrollenhet', 'kontroll enhet'],
  common: ['fiscal', 'receipt no', 'kvitto nr', 'receipt number', 'invoice number', 'fakturanummer'],
};

export const CURRENCY_SYMBOLS: Array<{ currency: string; symbols: string[] }> = [
  { currency: 'SEK', symbols: ['sek', 'kr', ':-'] },
  { currency: 'NOK', symbols: ['nok'] },
  { currency: 'DKK', symbols: ['dkk'] },
  { currency: 'EUR', symbols: ['eur', '€'] },
  { currency: 'USD', symbols: ['usd', '$'] },
  { currency: 'GBP', symbols: ['gbp', '£'] },
];

export function termsFor(dictionary: Record<string, string[]>, language: string | null): string[] {
  const common = dictionary.common ?? [];
  const langTerms = language ? dictionary[language] ?? [] : [];
  const allTerms = Object.values(dictionary).flat();
  return Array.from(new Set([...common, ...langTerms, ...allTerms]));
}
