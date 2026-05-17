export type ReceiptStatus = 'uploaded' | 'processing' | 'extracted' | 'reviewed' | 'invoice_ready' | 'invoiced' | 'failed';
export type InvoiceStatus = 'draft' | 'generating_pdf' | 'ready' | 'sent' | 'failed';
export type EventType = 'created' | 'ocr_started' | 'ocr_completed' | 'ocr_failed' | 'pdf_started' | 'pdf_completed' | 'pdf_failed' | 'email_sent' | 'email_failed' | 'state_changed' | 'invoice_created' | 'invoice_failed';

export interface User {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Receipt {
  id: string;
  userId: string;
  imageUrl: string;
  imageKey: string;
  merchantName: string | null;
  merchantAddress: string | null;
  receiptDate: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string;
  lineItems: LineItem[];
  status: ReceiptStatus;
  confidence: number | null;
  rawOcrResponse: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LineItem {
  id: string;
  receiptId: string | null;
  invoiceId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  sortOrder: number;
}

export interface Customer {
  id: string;
  userId: string;
  name: string;
  email: string;
  company: string | null;
  address: string | null;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceLegalMetadata {
  kontrollenhet: string;
  orgNumber: string;
  companyName: string;
  address: string;
}

export interface Invoice {
  id: string;
  userId: string;
  receiptId: string;
  customerId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  lineItems: LineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  notes: string | null;
  pdfUrl: string | null;
  status: InvoiceStatus;
  legalMetadata: InvoiceLegalMetadata | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceEvent {
  id: string;
  invoiceId: string;
  event: EventType;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
