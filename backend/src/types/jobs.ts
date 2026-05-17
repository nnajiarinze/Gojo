export const JobNames = {
  OCR_JOB: 'OCR_JOB',
  INVOICE_JOB: 'INVOICE_JOB',
  EMAIL_JOB: 'EMAIL_JOB',
} as const;

export interface OcrJobPayload {
  receiptId: string;
  userId: string;
  imageUrl: string;
}

export interface InvoiceJobPayload {
  invoiceId: string;
  userId: string;
}

export interface EmailJobPayload {
  invoiceId: string;
  to: string;
  subject: string;
  body: string;
}

export type JobPayload = OcrJobPayload | InvoiceJobPayload | EmailJobPayload;
