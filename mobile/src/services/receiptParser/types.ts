export type DocumentKind = 'receipt' | 'invoice' | 'card_slip' | 'refund' | 'unknown';

export type ProcessingStrategy = 'rules' | 'local_ml' | 'local_llm' | 'hybrid' | 'legacy' | 'manual';

export type SourceType = 'image' | 'pdf' | 'email_attachment' | 'pos_import' | 'text';

export type OcrEngine = 'device_ocr' | 'tesseract' | 'paddleocr' | 'doctr' | 'pdf_text' | 'unknown';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrWord {
  text: string;
  confidence: number | null;
  bbox?: BoundingBox;
}

export interface OcrLine {
  id: string;
  text: string;
  normalizedText: string;
  confidence: number | null;
  bbox?: BoundingBox;
  words?: OcrWord[];
}

export interface OcrPage {
  pageNumber: number;
  width?: number;
  height?: number;
  lines: OcrLine[];
}

export interface OcrDocument {
  id: string;
  sourceType: SourceType;
  rawText: string;
  pages: OcrPage[];
  detectedLanguage: string | null;
  engine: OcrEngine;
  confidence: number | null;
  createdAt: string;
}

export interface FieldEvidence {
  ocrLineIds: string[];
  rawText: string[];
  strategy: ProcessingStrategy;
  confidence: number;
  notes?: string[];
}

export interface NormalizedField<T> {
  value: T;
  confidence: number;
  evidence: FieldEvidence;
}

export interface TaxLine {
  label?: string;
  rate: NormalizedField<number | null>;
  base: NormalizedField<number | null>;
  amount: NormalizedField<number | null>;
}

export interface ReceiptLineItem {
  description: NormalizedField<string>;
  quantity: NormalizedField<number>;
  unitPrice: NormalizedField<number | null>;
  total: NormalizedField<number | null>;
  category?: NormalizedField<string | null>;
}

export interface ValidationCheck {
  passed: boolean | null;
  confidence: number;
  message?: string;
}

export type ValidationFlag =
  | 'missing_total'
  | 'missing_date'
  | 'missing_merchant'
  | 'tax_mismatch'
  | 'item_sum_mismatch'
  | 'low_ocr_confidence'
  | 'unknown_document_type'
  | 'possible_duplicate'
  | 'manual_review_required'
  | 'no_line_items';

export interface CanonicalReceipt {
  id: string;
  documentKind: DocumentKind;
  merchant: {
    name: NormalizedField<string | null>;
    legalName?: NormalizedField<string | null>;
    orgNumber?: NormalizedField<string | null>;
    vatNumber?: NormalizedField<string | null>;
    address?: NormalizedField<string | null>;
    phone?: NormalizedField<string | null>;
  };
  transaction: {
    receiptNumber?: NormalizedField<string | null>;
    date: NormalizedField<string | null>;
    time?: NormalizedField<string | null>;
    currency: NormalizedField<string>;
    subtotal?: NormalizedField<number | null>;
    total: NormalizedField<number | null>;
    paidAmount?: NormalizedField<number | null>;
    paymentMethod?: NormalizedField<string | null>;
  };
  tax: {
    totalTax: NormalizedField<number | null>;
    lines: TaxLine[];
  };
  lineItems: ReceiptLineItem[];
  fiscal: {
    fiscalId?: NormalizedField<string | null>;
    controlUnit?: NormalizedField<string | null>;
    qrPayload?: NormalizedField<string | null>;
  };
  validation: {
    itemSum: ValidationCheck;
    taxSum: ValidationCheck;
    subtotalTaxTotal: ValidationCheck;
    duplicateRisk: ValidationCheck;
    requiredFields: ValidationCheck;
    overallConfidence: number;
    reviewRequired: boolean;
    flags: ValidationFlag[];
  };
  provenance: {
    ocrDocumentId: string;
    parserVersion: string;
    strategy: ProcessingStrategy;
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
}

export interface Candidate<T> {
  value: T;
  candidateType:
    | 'merchant'
    | 'org_number'
    | 'address'
    | 'receipt_number'
    | 'date'
    | 'time'
    | 'currency'
    | 'subtotal'
    | 'total'
    | 'tax'
    | 'line_item'
    | 'payment_method'
    | 'fiscal_id';
  score: number;
  evidenceLineIds: string[];
  rawText: string[];
  reasons: string[];
}

export interface ReceiptInterpreter {
  name: string;
  version: string;
  interpret(input: OcrDocument): Promise<CanonicalReceipt> | CanonicalReceipt;
}

export interface InterpretationOptions {
  minConfidenceForAutoAccept?: number;
  parserVersion?: string;
}
