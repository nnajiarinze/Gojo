export { parseReceiptText, parseReceiptSafe, CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from './parser';
export type { ParsedReceipt, ParsedLineItem, MerchantLegalInfo, ParseResult } from './parser';
export { normalizeOcrText, parseSwedishPrice } from './normalize';
export { createOcrDocument, detectReceiptLanguage, normalizeForMatching } from './ocrDocument';
export { RuleBasedReceiptInterpreter, interpretReceipt } from './genericInterpreter';
export { extractCandidates } from './candidates';
export { validateCanonicalReceipt } from './validation';
export { toLegacyParsedReceipt } from './adapters';
export { runReceiptParserDemo } from './demo';
export type {
	BoundingBox,
	Candidate,
	CanonicalReceipt,
	DocumentKind,
	FieldEvidence,
	InterpretationOptions,
	NormalizedField,
	OcrDocument,
	OcrEngine,
	OcrLine,
	OcrPage,
	OcrWord,
	ProcessingStrategy,
	ReceiptInterpreter,
	ReceiptLineItem,
	SourceType,
	TaxLine,
	ValidationCheck,
	ValidationFlag,
} from './types';
