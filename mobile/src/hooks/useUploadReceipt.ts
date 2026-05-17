import { useState, useCallback } from 'react';
import { uploadReceiptImage, processOcr } from '../api/receipts';
import { useReceiptStore } from '../store/receiptStore';
import { recognizeText } from '../services/ocrService';
import { parseReceiptText } from '../services/receiptParser';

export function useUploadReceipt() {
  const [isUploading, setIsUploading] = useState(false);
  const { setReceiptId, setStep, setError, setLocalOcr, setParsedReceipt } = useReceiptStore();

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

        // Parse OCR text into structured receipt data
        try {
          const parsed = parseReceiptText(ocrResult.text);
          console.log(`[Upload] Parsed: ${parsed.lineItems.length} items, total: ${parsed.totalAmount}`);
          setParsedReceipt(parsed);
        } catch (parseErr: any) {
          console.warn('[Upload] Parser failed (non-fatal):', parseErr.message);
        }
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
  }, [setReceiptId, setStep, setError, setLocalOcr]);

  return { upload, isUploading };
}
