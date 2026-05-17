// Domain types — must match backend exactly

export type ReceiptStatus =
  | 'uploaded'
  | 'processing'
  | 'extracted'
  | 'reviewed'
  | 'invoice_ready'
  | 'invoiced'
  | 'failed';

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  sortOrder: number;
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
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLegalMetadata {
  kontrollenhet: string;
  orgNumber: string;
  companyName: string;
  address: string;
}

export interface Invoice {
  id: string;
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
  status: string;
  sentAt: string | null;
  receiptId: string;
  legal: InvoiceLegalMetadata | null;
  createdAt: string;
}

export interface InvoiceCreatedResponse {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
}

// API request/response types

export interface UploadReceiptRequest {
  fileName: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/heic';
}

export interface UploadReceiptResponse {
  receiptId: string;
  uploadUrl: string;
  imageKey: string;
}

export interface ProcessOcrRequest {
  receiptId: string;
}

export interface ProcessOcrResponse {
  jobId: string;
  status: 'processing';
}

export interface GenerateInvoiceRequest {
  receiptId: string;
  customerId: string;
  dueDate: string;
  taxRate: number;
  taxAmount?: number;
  subtotal?: number;
  totalAmount?: number;
  notes?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  legal?: InvoiceLegalMetadata;
}

export type GenerateInvoiceResponse = InvoiceCreatedResponse;

export interface ReviewReceiptResponse {
  status: 'reviewed';
}

export interface ApiError {
  error: string;
  message?: string;
  rule?: string;
  details?: unknown;
}
