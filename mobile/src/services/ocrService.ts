import { NativeModules, Platform } from 'react-native';

export interface OCRResult {
  text: string;
  confidence: number;
  lines: Array<{ text: string; confidence: number }>;
}

/**
 * Runs on-device OCR using Apple Vision (iOS) or returns a stub (Android).
 */
export async function recognizeText(imageUri: string): Promise<OCRResult> {
  if (Platform.OS === 'ios') {
    const { AppleVisionOCR } = NativeModules;
    if (!AppleVisionOCR) {
      console.warn('[OCR] AppleVisionOCR native module not available, using fallback');
      return fallbackResult();
    }
    try {
      const start = Date.now();
      const result = await AppleVisionOCR.recognizeText(imageUri);
      const duration = Date.now() - start;
      console.log(`[OCR] Apple Vision returned ${result.lines?.length ?? 0} lines, confidence: ${result.confidence}`);
      console.log(`[OCR] Duration: ${duration}ms`);
      console.log(`[OCR] === RAW TEXT START ===`);
      console.log(result.text);
      console.log(`[OCR] === RAW TEXT END ===`);
      return result as OCRResult;
    } catch (error: any) {
      console.error('[OCR] Apple Vision error:', error.message);
      return fallbackResult();
    }
  }

  // Android: stub fallback (replace with ML Kit if needed)
  console.log('[OCR] Android fallback — returning empty result');
  return fallbackResult();
}

function fallbackResult(): OCRResult {
  return {
    text: '',
    confidence: 0,
    lines: [],
  };
}
