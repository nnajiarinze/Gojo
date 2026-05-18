import { useState, useCallback } from 'react';
import { uploadReceiptImage, processOcr } from '../api/receipts';
import { useReceiptStore } from '../store/receiptStore';
import { recognizeText } from '../services/ocrService';
import { createOcrDocument, interpretReceipt, parseReceiptSafe, toLegacyParsedReceipt } from '../services/receiptParser';
import type { CanonicalReceipt, ParsedReceipt } from '../services/receiptParser';

export function useUploadReceipt() {
  const [isUploading, setIsUploading] = useState(false);
  const { parserMode, setReceiptId, setStep, setError, setLocalOcr, setParsedReceipt, setParseResult } = useReceiptStore();

  const upload = useCallback(async (imageUri: string) => {
    setIsUploading(true);
    setStep('uploading');

    try {
      console.log('[Upload] Starting upload...');

      // Run native OCR in parallel with backend receipt creation.
      // The local OCR result is stored in Zustand for the review screen.
      const [uploadResult, ocrResult] = await Promise.all([
        uploadReceiptImage({
          fileName: `receipt_${Date.now()}.jpg`,
          contentType: 'image/jpeg',
        }),
        recognizeText(imageUri).catch((err) => {
          console.warn('[Upload] Local OCR failed (non-fatal):', err.message);
          return null;
        }),
      ]);

      const { receiptId } = uploadResult;
      console.log(`[Upload] Created receipt: ${receiptId}`);

      if (ocrResult && ocrResult.text.length > 0) {
        console.log(`[Upload] Local OCR: ${ocrResult.lines.length} lines, confidence: ${ocrResult.confidence.toFixed(2)}`);
        setLocalOcr(ocrResult);

        const result = parserMode === 'gojo'
          ? parseReceiptSafe(ocrResult.text)
          : parseWithGenericParser(ocrResult.text, ocrResult.confidence);
        if (__DEV__) console.log(`[Upload] Parser mode: ${parserMode}`);
        setParseResult(result);

        if (result.success) {
          console.log(`[Upload] Parse SUCCESS: ${result.data.lineItems.length} items, total: ${result.data.totalAmount}, confidence: ${result.confidence}`);
          setParsedReceipt(result.data);
        } else {
          console.warn(`[Upload] Parse FAILED: ${result.reason} (confidence: ${result.confidence})`);
          // Don't set parsedReceipt — let the UI handle the failure state
        }
      } else {
        console.warn('[Upload] No OCR text available');
        setParseResult({
          success: false,
          reason: 'OCR kunde inte läsa texten från bilden',
          confidence: 0,
        });
      }

      // TODO: Upload actual image binary to S3 pre-signed URL

      setStep('processing');
      await processOcr({ receiptId });
      console.log(`[Upload] OCR triggered for: ${receiptId}`);

      // Set receiptId LAST so polling starts after OCR is enqueued
      setReceiptId(receiptId);
    } catch (err: any) {
      const message =
        err?.response?.data?.error ?? err?.message ?? 'Upload failed';
      console.error('[Upload] Error:', message);
      setError(message);
    } finally {
      setIsUploading(false);
    }
  }, [parserMode, setReceiptId, setStep, setError, setLocalOcr, setParsedReceipt, setParseResult]);

  return { upload, isUploading };
}

function parseWithGenericParser(rawText: string, confidence: number) {
  const canonicalReceipt = interpretReceipt(createOcrDocument({
    rawText,
    sourceType: 'image',
    engine: 'device_ocr',
    confidence,
  }));
  const parsedReceipt = toLegacyParsedReceipt(canonicalReceipt);
  logGenericParserResult(canonicalReceipt, parsedReceipt);
  return canonicalReceipt.validation.reviewRequired && !parsedReceipt.totalAmount
    ? {
        success: false as const,
        reason: 'Kunde inte tolka kvittot automatiskt',
        confidence: canonicalReceipt.validation.overallConfidence,
        partialData: parsedReceipt,
      }
    : {
        success: true as const,
        data: parsedReceipt,
        confidence: canonicalReceipt.validation.overallConfidence,
      };
}

function logGenericParserResult(canonical: CanonicalReceipt, legacy: ParsedReceipt) {
  if (!__DEV__) return;

  console.log('[GenericParser] ═══ CANONICAL RESULT ═══');
  console.log(`[GenericParser] kind=${canonical.documentKind}, confidence=${canonical.validation.overallConfidence.toFixed(2)}, review=${canonical.validation.reviewRequired}`);
  console.log(`[GenericParser] merchant=${canonical.merchant.name.value ?? '(missing)'} (${canonical.merchant.name.confidence.toFixed(2)})`);
  console.log(`[GenericParser] date=${canonical.transaction.date.value ?? '(missing)'}, time=${canonical.transaction.time?.value ?? '(missing)'}`);
  console.log(`[GenericParser] currency=${canonical.transaction.currency.value}, subtotal=${canonical.transaction.subtotal?.value ?? 'null'}, vat=${canonical.tax.totalTax.value ?? 'null'}, total=${canonical.transaction.total.value ?? 'null'}`);
  console.log(`[GenericParser] org=${canonical.merchant.orgNumber?.value ?? '(missing)'}, address=${canonical.merchant.address?.value ?? '(missing)'}`);
  console.log(`[GenericParser] receiptNo=${canonical.transaction.receiptNumber?.value ?? '(missing)'}, fiscal=${canonical.fiscal.fiscalId?.value ?? '(missing)'}`);
  console.log(`[GenericParser] items=${canonical.lineItems.length}, flags=${canonical.validation.flags.join(',') || '(none)'}`);
  canonical.lineItems.slice(0, 20).forEach((item, index) => {
    console.log(`[GenericParser] item[${index}] ${item.quantity.value}x ${item.description.value} unit=${item.unitPrice.value ?? 'null'} total=${item.total.value ?? 'null'} conf=${item.total.confidence.toFixed(2)}`);
  });
  console.log(`[GenericParser] legacy merchant=${legacy.merchantName}, subtotal=${legacy.subtotal}, vat=${legacy.vat ?? 'null'}, total=${legacy.totalAmount}, kontrollenhet=${legacy.kontrollenhet || '(missing)'}`);
  console.log('[GenericParser] ═════════════════════════');
}
