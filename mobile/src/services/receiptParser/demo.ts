import { createOcrDocument } from './ocrDocument';
import { interpretReceipt } from './genericInterpreter';
import { englishGenericReceipt, swedishGenericReceipt } from './fixtures/swedish-generic';

export function runReceiptParserDemo() {
  const samples = [swedishGenericReceipt, englishGenericReceipt];
  return samples.map((rawText, index) => {
    const ocr = createOcrDocument({ rawText, id: `fixture-${index + 1}`, sourceType: 'text', engine: 'device_ocr' });
    return interpretReceipt(ocr);
  });
}
