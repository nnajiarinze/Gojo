/**
 * Deterministic parser for Swedish restaurant receipt OCR text.
 *
 * State-machine approach: tracks current item and awaits its price line(s).
 *
 * Supported formats:
 *   FORMAT A: "5 x Chai" + "(á 35,00) 175,00"  → qty=5, unit=35, total=175
 *   FORMAT B: "1 x Kitfo" + "(á 224,00) 224,00" → qty=1, unit=224, total=224
 *   FORMAT C: "1 x Kuanta Firfir" + "224,00"    → qty=1, unit=224, total=224
 *   Split:    "(á 35,00)" on one line, "175,00" on next
 */

import { normalizeOcrText, parseSwedishPrice, normalizeLine } from './normalize';

// ─── Types ───────────────────────────────────────────────────────────

export interface ParsedLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface MerchantLegalInfo {
  companyName: string;
  orgNumber: string;
  address: string;
}

export interface ParsedReceipt {
  merchantName: string;
  currency: 'SEK';
  subtotal: number;
  vat: number | null;
  totalAmount: number;
  lineItems: ParsedLineItem[];
  kontrollenhet: string;
  merchantLegalInfo: MerchantLegalInfo;
  confidence: number;
  debug: {
    classifiedLines: Array<{ line: string; type: string }>;
    skippedLines: string[];
    warnings: string[];
    vatSource: 'receipt' | 'computed' | 'missing';
    durationMs: number;
  };
}

// ─── Patterns ────────────────────────────────────────────────────────

const ITEM_PATTERN = /^(\d+)\s*x\s+(.+)$/i;
const UNIT_AND_TOTAL_PATTERN = /^\([\wáéàö6]\s*([\d\s.,]+)\)\s+([\d\s.,]+)$/;
const UNIT_ONLY_PATTERN = /^\([\wáéàö6]\s*([\d\s.,]+)\)\s*$/;
const NUMBER_PATTERN = /^:?\s*([\d\s.,]+)$/;

const BELOPP_PATTERN = /^Belopp\s+([\d\s.,]+)\s*SEK?$/i;
const MOMS_PATTERN = /^Moms\s+([\d\s.,]+)$/i;
const NETTO_PATTERN = /^Netto\s+([\d\s.,]+)$/i;
const SUMMA_PATTERN = /^Summa\s+([\d\s.,]+)$/i;
const TOTALT_PATTERN = /^TOTALT$/i;

// Payment markers — these are NOT stop boundaries, just classification hints
const PAYMENT_MARKERS = [
  /MASTERCARD/i, /VISA/i, /Kort\.?nr/i, /Auth/i, /Ref\.?nr/i,
  /CVM/i, /AID:/i, /ContactLess/i, /OnlinePIN/i, /Dricks/i,
  /inkl\.\s*dricks/i, /Kortterminal/i, /Kortnamn/i, /Kassör/i,
  /Kassa$/i, /Kvitto\.?nr/i, /Hemsida/i, /Telne/i, /Epost/i,
];

// Post-Kontrollenhet noise — stop parsing when these appear AFTER Kontrollenhet
const POST_KONTROLLENHET_NOISE = [
  /Välkommen/i, /välkommen\s*åter/i,
];

// Footer extraction patterns — tolerant of OCR misreads
// Handles: Kontrollenhet, Kontro1 enhet, Kontrol1enhet, Kontro| enhet, etc.
const KONTROLLENHET_PATTERNS = [
  /kontroll?\s*enhet\s*[:\-]?\s*(.+)/i,        // clean: Kontrollenhet: XXX
  /kontro[l1|i]\s*[l1|i]?\s*[e3]nhet\s*[:\-]?\s*(.+)/i,  // OCR variants: Kontro1 enhet, Kontro| enhet
  /kontro[l1|i]\s*[le]\s*nhet\s*[:\-]?\s*(.+)/i,          // split: Kontro1 e nhet
  /kontrollenhet\s*[:\-]?\s*(.+)/i,             // exact match fallback
];
const KONTROLLENHET_LABEL_ONLY = [
  /kontroll?\s*enhet\s*[:\-]?\s*$/i,
  /kontro[l1|i]\s*[l1|i]?\s*[e3]nhet\s*[:\-]?\s*$/i,
];
const ORG_NUMBER_PATTERN = /^Organisationsnummer:?\s*(.+)$/i;
const ORG_NUMBER_INLINE = /Org\.?\s*(?:nr|nummer):?\s*([\d\s-]+)/i;

const METADATA_PATTERNS = [
  /^KVITTO/i, /^KOPIA/i, /^\d{4}-\d{2}-\d{2}/, /^Bord\s+\d+/i,
];

function isPayment(l: string) { return PAYMENT_MARKERS.some((p) => p.test(l)); }
function isMeta(l: string) { return METADATA_PATTERNS.some((p) => p.test(l)); }
function isPostKontrollenhetNoise(l: string) { return POST_KONTROLLENHET_NOISE.some((p) => p.test(l)); }
function isTotalsLine(l: string) {
  return BELOPP_PATTERN.test(l) || MOMS_PATTERN.test(l) || NETTO_PATTERN.test(l) || SUMMA_PATTERN.test(l);
}

// ─── Parser ──────────────────────────────────────────────────────────

export function parseReceiptText(rawText: string): ParsedReceipt {
  const start = Date.now();
  const text = normalizeOcrText(rawText);
  const allLines = text.split('\n').map((l) => normalizeLine(l)).filter((l) => l.length > 0);

  const classifiedLines: Array<{ line: string; type: string }> = [];
  const skippedLines: string[] = [];
  const warnings: string[] = [];
  const lineItems: ParsedLineItem[] = [];

  // Merchant name = first non-meta, non-item, non-number short line
  let merchantName = '';
  for (const line of allLines) {
    if (isMeta(line)) continue;
    if (ITEM_PATTERN.test(line)) break;
    if (!NUMBER_PATTERN.test(line) && !isPayment(line) && !isTotalsLine(line) && line.length < 40) {
      merchantName = line;
      break;
    }
  }

  // Detect layout: TOTALT-separated vs interleaved
  const totaltIdx = allLines.findIndex((l) => TOTALT_PATTERN.test(l));

  if (totaltIdx >= 0) {
    parseTotaltLayout(allLines, totaltIdx, lineItems, classifiedLines, skippedLines, warnings);
  } else {
    parseInterleavedLayout(allLines, lineItems, classifiedLines, skippedLines, warnings);
  }

  // Validate qty × unitPrice ≈ total
  for (const item of lineItems) {
    if (item.quantity > 1 && item.unitPrice > 0 && item.total > 0) {
      const expected = Math.round(item.unitPrice * item.quantity * 100) / 100;
      if (Math.abs(item.total - expected) > 1) {
        warnings.push(`Mismatch: ${item.description} ${item.quantity}×${item.unitPrice}=${expected} vs ${item.total}`);
        item.total = expected;
      }
    }
  }

  // ─── Extract totals with strict VAT resolution ───
  let totalAmount = 0, subtotal = 0;
  let receiptVat: number | null = null; // null = not found on receipt
  let vatSource: 'receipt' | 'computed' | 'missing' = 'missing';

  for (let idx = 0; idx < allLines.length; idx++) {
    const line = allLines[idx];
    const nextLine = idx + 1 < allLines.length ? allLines[idx + 1] : '';
    let m: RegExpExecArray | null;

    // Belopp (total amount)
    if ((m = BELOPP_PATTERN.exec(line))) {
      totalAmount = parseSwedishPrice(m[1]) ?? 0;
    }

    // Moms (VAT) — same line or next line
    if ((m = MOMS_PATTERN.exec(line))) {
      receiptVat = parseSwedishPrice(m[1]);
    } else if (/^[HM]o[mn]s$/i.test(line.replace(/\s+X$/i, '').trim()) && NUMBER_PATTERN.test(nextLine)) {
      // "Moms" or "Homs" alone on a line (OCR misread), value on next line
      const nm = NUMBER_PATTERN.exec(nextLine);
      if (nm) {
        receiptVat = parseSwedishPrice(nm[1]);
        console.log(`[Parser] Moms found split-line: "${line}" + "${nextLine}" → ${receiptVat}`);
      }
    }

    // Netto — same line or next line
    if ((m = NETTO_PATTERN.exec(line))) {
      subtotal = parseSwedishPrice(m[1]) ?? 0;
    } else if (/^Netto$/i.test(line.trim()) && NUMBER_PATTERN.test(nextLine)) {
      const nm = NUMBER_PATTERN.exec(nextLine);
      if (nm) {
        subtotal = parseSwedishPrice(nm[1]) ?? 0;
        console.log(`[Parser] Netto found split-line: "${line}" + "${nextLine}" → ${subtotal}`);
      }
    }

    // Summa fallback
    if (totalAmount === 0 && (m = SUMMA_PATTERN.exec(line))) {
      totalAmount = parseSwedishPrice(m[1]) ?? 0;
    } else if (totalAmount === 0 && /^Summa$/i.test(line.trim()) && NUMBER_PATTERN.test(nextLine)) {
      const nm = NUMBER_PATTERN.exec(nextLine);
      if (nm) totalAmount = parseSwedishPrice(nm[1]) ?? 0;
    }
  }

  // VAT RESOLUTION PRIORITY (CRITICAL):
  // 1. If Moms line found on receipt → use it directly, NEVER recompute
  // 2. If Moms missing but total and netto exist → compute: total - netto
  // 3. If both missing → null (no guessing)
  let vat: number | null;
  if (receiptVat !== null) {
    vat = receiptVat;
    vatSource = 'receipt';
    console.log(`[Parser] VAT source: RECEIPT (Moms line) → ${vat}`);
  } else if (totalAmount > 0 && subtotal > 0) {
    vat = Math.round((totalAmount - subtotal) * 100) / 100;
    vatSource = 'computed';
    console.log(`[Parser] VAT source: COMPUTED (${totalAmount} - ${subtotal}) → ${vat}`);
  } else {
    vat = null;
    vatSource = 'missing';
    console.log('[Parser] VAT source: MISSING — no Moms line, no netto');
    warnings.push('VAT (Moms) not found on receipt');
  }

  // Derive subtotal if missing
  if (subtotal === 0 && totalAmount > 0 && vat !== null && vat > 0) {
    subtotal = Math.round((totalAmount - vat) * 100) / 100;
  }
  if (totalAmount === 0) {
    totalAmount = lineItems.reduce((s, li) => s + li.total, 0);
    warnings.push('Total not found, using sum of items');
  }

  // ─── Extract footer: Kontrollenhet + merchant legal info ───
  // Scan BOTH normalized lines AND raw lines for maximum coverage
  let kontrollenhet = '';
  const merchantLegalInfo: MerchantLegalInfo = { companyName: '', orgNumber: '', address: '' };
  let kontrollenhetFound = false;

  const rawLines = rawText.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter((l) => l.length > 0);

  // Helper: try all Kontrollenhet patterns against a line
  function tryKontrollenhet(line: string): string | null {
    for (const pat of KONTROLLENHET_PATTERNS) {
      const m = pat.exec(line);
      if (m && m[1] && m[1].trim().length > 0) return m[1].trim();
    }
    return null;
  }
  function isKontrollenhetLabel(line: string): boolean {
    return KONTROLLENHET_LABEL_ONLY.some((p) => p.test(line));
  }

  // First pass: scan normalized lines
  for (let li = 0; li < allLines.length; li++) {
    const line = allLines[li];

    if (!kontrollenhetFound) {
      const val = tryKontrollenhet(line);
      if (val) {
        kontrollenhet = val;
        kontrollenhetFound = true;
        classifiedLines.push({ line, type: 'kontrollenhet' });
        console.log(`[Parser] Kontrollenhet (normalized): ${kontrollenhet}`);
        continue;
      }
      // Label-only on this line, value on next
      if (isKontrollenhetLabel(line) && li + 1 < allLines.length) {
        kontrollenhet = allLines[li + 1].trim();
        kontrollenhetFound = true;
        classifiedLines.push({ line, type: 'kontrollenhet' });
        console.log(`[Parser] Kontrollenhet (split-line): ${kontrollenhet}`);
        continue;
      }
    }

    // Org number
    const orgMatch = ORG_NUMBER_PATTERN.exec(line) || ORG_NUMBER_INLINE.exec(line);
    if (orgMatch) {
      merchantLegalInfo.orgNumber = orgMatch[1].trim();
      classifiedLines.push({ line, type: 'org-number' });
      console.log(`[Parser] OrgNumber: ${merchantLegalInfo.orgNumber}`);
      continue;
    }

    // Company name: look for "AB" pattern (e.g. "Gojo AB")
    if (/\b[A-Z][a-zA-ZåäöÅÄÖ]*\s+AB\b/.test(line) && !merchantLegalInfo.companyName) {
      merchantLegalInfo.companyName = line.trim();
      classifiedLines.push({ line, type: 'company-name' });
      console.log(`[Parser] CompanyName: ${merchantLegalInfo.companyName}`);
      continue;
    }

    // Address: Swedish postal code pattern (3-5 digits + city), only after payment section
    if (/\d{3}\s*\d{2}\s+[A-ZÅÄÖ]/i.test(line) && !merchantLegalInfo.address) {
      // Capture previous line as street if it looks like a street address (not org number)
      if (li > 0 && /\d/.test(allLines[li - 1]) && /[a-zåäö]/i.test(allLines[li - 1]) && allLines[li - 1].length < 50 && !ORG_NUMBER_PATTERN.test(allLines[li - 1]) && !ORG_NUMBER_INLINE.test(allLines[li - 1])) {
        merchantLegalInfo.address = `${allLines[li - 1].trim()}, ${line.trim()}`;
      } else {
        merchantLegalInfo.address = line.trim();
      }
      classifiedLines.push({ line, type: 'address' });
      console.log(`[Parser] Address: ${merchantLegalInfo.address}`);
      continue;
    }
  }

  // Fallback: scan RAW (pre-normalized) lines if Kontrollenhet still not found
  if (!kontrollenhetFound) {
    console.log(`[Parser] Kontrollenhet not in normalized lines, scanning raw OCR...`);
    for (let ri = 0; ri < rawLines.length; ri++) {
      const rline = rawLines[ri];
      const val = tryKontrollenhet(rline);
      if (val) {
        kontrollenhet = val;
        kontrollenhetFound = true;
        console.log(`[Parser] Kontrollenhet (raw fallback): ${kontrollenhet}`);
        break;
      }
      if (isKontrollenhetLabel(rline) && ri + 1 < rawLines.length) {
        kontrollenhet = rawLines[ri + 1].trim();
        kontrollenhetFound = true;
        console.log(`[Parser] Kontrollenhet (raw split-line): ${kontrollenhet}`);
        break;
      }
    }
  }

  if (!kontrollenhetFound) {
    warnings.push('Kontrollenhet not found');
    console.log(`[Parser] ⚠ Kontrollenhet NOT FOUND in ${allLines.length} normalized + ${rawLines.length} raw lines`);
  }

  // ─── Total consistency validation (log-only, no auto-override) ───
  const itemsTotal = Math.round(lineItems.reduce((s, li) => s + li.total, 0) * 100) / 100;

  // Check: sum(lineItems) ≈ subtotal
  if (subtotal > 0 && Math.abs(itemsTotal - subtotal) > 1) {
    console.log(`[Parser] ⚠ CONSISTENCY: items sum ${itemsTotal} ≠ subtotal ${subtotal} (diff: ${Math.abs(itemsTotal - subtotal).toFixed(2)})`);
    warnings.push(`Items sum ${itemsTotal} differs from subtotal ${subtotal}`);
  } else if (subtotal > 0) {
    console.log(`[Parser] ✓ CONSISTENCY: items sum ${itemsTotal} ≈ subtotal ${subtotal}`);
  }

  // Check: VAT + netto ≈ total
  if (vat !== null && subtotal > 0 && totalAmount > 0) {
    const vatPlusNet = Math.round((vat + subtotal) * 100) / 100;
    if (Math.abs(vatPlusNet - totalAmount) > 1) {
      console.log(`[Parser] ⚠ CONSISTENCY: VAT(${vat}) + Netto(${subtotal}) = ${vatPlusNet} ≠ Total(${totalAmount})`);
      warnings.push(`VAT + Netto = ${vatPlusNet} differs from total ${totalAmount}`);
    } else {
      console.log(`[Parser] ✓ CONSISTENCY: VAT(${vat}) + Netto(${subtotal}) = ${vatPlusNet} ≈ Total(${totalAmount})`);
    }
  }

  // Confidence
  let confidence = 1.0;
  if (subtotal > 0 && Math.abs(itemsTotal - subtotal) > subtotal * 0.05) {
    confidence -= 0.2;
  }
  if (lineItems.length === 0) { warnings.push('No items'); confidence -= 0.5; }
  const zeros = lineItems.filter((li) => li.total === 0).length;
  if (zeros > 0) { warnings.push(`${zeros} zero-total items`); confidence -= 0.1 * zeros; }
  if (vatSource === 'missing') confidence -= 0.1;
  confidence = Math.max(0, Math.min(1, confidence));

  const validItems = lineItems.filter((li) => li.total > 0);
  const durationMs = Date.now() - start;

  // Debug
  console.log('[Parser] === PARSE RESULT ===');
  console.log(`[Parser] Merchant: ${merchantName}`);
  console.log(`[Parser] Items: ${validItems.length}`);
  for (const it of validItems) console.log(`[Parser]   ${it.quantity}x ${it.description} @ ${it.unitPrice} = ${it.total}`);
  console.log(`[Parser] Subtotal: ${subtotal}, VAT: ${vat ?? 'null'} (${vatSource}), Total: ${totalAmount}, Items sum: ${itemsTotal}`);
  console.log(`[Parser] Kontrollenhet: ${kontrollenhet || '(not found)'}`);
  console.log(`[Parser] Legal: ${merchantLegalInfo.companyName} | ${merchantLegalInfo.orgNumber} | ${merchantLegalInfo.address}`);
  console.log(`[Parser] Confidence: ${(confidence * 100).toFixed(0)}% | ${durationMs}ms`);
  if (warnings.length) console.log(`[Parser] Warnings: ${warnings.join('; ')}`);

  return { merchantName, currency: 'SEK', subtotal, vat: vat ?? 0, totalAmount, lineItems: validItems, kontrollenhet, merchantLegalInfo, confidence, debug: { classifiedLines, skippedLines, warnings, vatSource, durationMs } };
}

// ─── TOTALT Layout ───────────────────────────────────────────────────
// Items listed before TOTALT, prices listed after TOTALT in same order.

function parseTotaltLayout(
  lines: string[], totaltIdx: number,
  items: ParsedLineItem[], classified: Array<{ line: string; type: string }>,
  skipped: string[], warnings: string[],
) {
  console.log('[Parser] Layout: TOTALT-separated');

  // Collect items before TOTALT
  const preItems: Array<{ description: string; quantity: number }> = [];
  for (let i = 0; i < totaltIdx; i++) {
    const line = lines[i];
    const m = ITEM_PATTERN.exec(line);
    if (m) {
      preItems.push({ description: m[2].trim(), quantity: parseInt(m[1], 10) });
      classified.push({ line, type: 'item' });
      console.log(`[Parser] Item: ${m[1]}x ${m[2].trim()}`);
    } else {
      classified.push({ line, type: isMeta(line) ? 'metadata' : 'skip' });
    }
  }
  classified.push({ line: lines[totaltIdx], type: 'TOTALT' });

  // Collect prices after TOTALT — one price entry per item
  const prices: Array<{ unitPrice: number; total: number }> = [];
  let i = totaltIdx + 1;
  while (i < lines.length && prices.length < preItems.length) {
    const line = lines[i];
    if (isTotalsLine(line)) { classified.push({ line, type: 'totals-footer' }); break; }
    if (isPayment(line)) { classified.push({ line, type: 'payment' }); break; }

    // "(á XX,XX) YY,YY"
    const utMatch = UNIT_AND_TOTAL_PATTERN.exec(line);
    if (utMatch) {
      prices.push({ unitPrice: parseSwedishPrice(utMatch[1]) ?? 0, total: parseSwedishPrice(utMatch[2]) ?? 0 });
      classified.push({ line, type: 'price:unit+total' });
      console.log(`[Parser] Price: unit=${prices[prices.length-1].unitPrice} total=${prices[prices.length-1].total}`);
      i++; continue;
    }

    // "(á XX,XX)" — split line, total on next
    const uoMatch = UNIT_ONLY_PATTERN.exec(line);
    if (uoMatch) {
      const up = parseSwedishPrice(uoMatch[1]) ?? 0;
      classified.push({ line, type: 'price:unit-only' });
      if (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nm = NUMBER_PATTERN.exec(next);
        if (nm && !isPayment(next) && !isTotalsLine(next)) {
          const tot = parseSwedishPrice(nm[1]) ?? 0;
          prices.push({ unitPrice: up, total: tot });
          classified.push({ line: next, type: 'price:total-cont' });
          console.log(`[Parser] Price (split): unit=${up} total=${tot}`);
          i += 2; continue;
        }
      }
      prices.push({ unitPrice: up, total: up });
      i++; continue;
    }

    // Standalone number
    const nm = NUMBER_PATTERN.exec(line);
    if (nm) {
      const val = parseSwedishPrice(nm[1]);
      if (val !== null && val > 0) {
        prices.push({ unitPrice: val, total: val });
        classified.push({ line, type: 'price:standalone' });
        console.log(`[Parser] Price (standalone): ${val}`);
        i++; continue;
      }
    }

    classified.push({ line, type: 'unknown' });
    skipped.push(line);
    i++;
  }

  // Pair items ↔ prices
  for (let j = 0; j < preItems.length; j++) {
    const it = preItems[j];
    const pr = j < prices.length ? prices[j] : { unitPrice: 0, total: 0 };
    let { unitPrice, total } = pr;

    // Derive missing values
    if (it.quantity === 1) {
      // For qty=1: total IS the price. unitPrice = total.
      if (total > 0) unitPrice = total;
      else if (unitPrice > 0) total = unitPrice;
    } else {
      // For qty>1: unitPrice is per-item
      if (total === 0 && unitPrice > 0) total = Math.round(unitPrice * it.quantity * 100) / 100;
      if (unitPrice === 0 && total > 0) unitPrice = Math.round((total / it.quantity) * 100) / 100;
    }

    console.log(`[Parser] Paired: ${it.quantity}x ${it.description} → unit=${unitPrice} total=${total}`);
    items.push({ description: it.description, quantity: it.quantity, unitPrice, total });
  }
}

// ─── Interleaved Layout ──────────────────────────────────────────────
// Each item is immediately followed by its price line(s).

function parseInterleavedLayout(
  lines: string[],
  items: ParsedLineItem[], classified: Array<{ line: string; type: string }>,
  skipped: string[], warnings: string[],
) {
  console.log('[Parser] Layout: interleaved');

  let currentItem: { description: string; quantity: number } | null = null;
  let pendingUnit: number | null = null;
  type State = 'scanning' | 'awaiting_price' | 'awaiting_total';
  let state: State = 'scanning';

  function flushItem(unitPrice: number, total: number) {
    if (!currentItem) return;
    const q = currentItem.quantity;
    if (q === 1) { unitPrice = total > 0 ? total : unitPrice; total = total > 0 ? total : unitPrice; }
    else { if (total === 0 && unitPrice > 0) total = Math.round(unitPrice * q * 100) / 100; if (unitPrice === 0 && total > 0) unitPrice = Math.round((total / q) * 100) / 100; }
    console.log(`[Parser] Paired: ${q}x ${currentItem.description} → unit=${unitPrice} total=${total}`);
    items.push({ description: currentItem.description, quantity: q, unitPrice, total });
    currentItem = null; pendingUnit = null; state = 'scanning';
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isPostKontrollenhetNoise(line)) { classified.push({ line, type: 'post-kontrollenhet' }); break; }
    if (isPayment(line)) { classified.push({ line, type: 'payment' }); continue; }
    if (isTotalsLine(line) || TOTALT_PATTERN.test(line)) { classified.push({ line, type: 'totals' }); continue; }
    if (isMeta(line)) { classified.push({ line, type: 'metadata' }); continue; }

    const itemMatch = ITEM_PATTERN.exec(line);
    if (itemMatch) {
      if (currentItem) warnings.push(`"${currentItem.description}" had no price`);
      currentItem = { description: itemMatch[2].trim(), quantity: parseInt(itemMatch[1], 10) };
      classified.push({ line, type: 'item' });
      state = 'awaiting_price';
      continue;
    }

    if (state === 'awaiting_price' && currentItem) {
      const ut = UNIT_AND_TOTAL_PATTERN.exec(line);
      if (ut) { classified.push({ line, type: 'price:unit+total' }); flushItem(parseSwedishPrice(ut[1]) ?? 0, parseSwedishPrice(ut[2]) ?? 0); continue; }
      const uo = UNIT_ONLY_PATTERN.exec(line);
      if (uo) { pendingUnit = parseSwedishPrice(uo[1]) ?? 0; classified.push({ line, type: 'price:unit-only' }); state = 'awaiting_total'; continue; }
      const nm = NUMBER_PATTERN.exec(line);
      if (nm) { const v = parseSwedishPrice(nm[1]); if (v && v > 0) { classified.push({ line, type: 'price:standalone' }); flushItem(0, v); continue; } }
      classified.push({ line, type: 'unknown' }); skipped.push(line); continue;
    }

    if (state === 'awaiting_total' && currentItem && pendingUnit !== null) {
      const nm = NUMBER_PATTERN.exec(line);
      if (nm) { const v = parseSwedishPrice(nm[1]); if (v && v > 0) { classified.push({ line, type: 'price:total-cont' }); flushItem(pendingUnit, v); continue; } }
      flushItem(pendingUnit, 0); // fallback, re-process line
      i--; continue;
    }

    classified.push({ line, type: 'unknown' }); skipped.push(line);
  }

  if (currentItem) warnings.push(`"${currentItem.description}" at end had no price`);
}
