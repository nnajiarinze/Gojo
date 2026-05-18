import { apiClient } from './client';
import type {
  UploadReceiptRequest,
  UploadReceiptResponse,
  ProcessOcrRequest,
  ProcessOcrResponse,
  Receipt,
  Invoice,
  InvoicePdfStatus,
  EmailDeliveryStatus,
  PaymentStatus,
  ReviewReceiptResponse,
  GenerateInvoiceRequest,
  GenerateInvoiceResponse,
} from '../types/api';

function normalizePdfStatus(value: string | undefined): InvoicePdfStatus {
  if (value === 'sent') return 'ready';
  if (value === 'draft' || value === 'generating_pdf' || value === 'ready' || value === 'failed') return value;
  return 'draft';
}

function normalizeEmailStatus(invoice: Invoice): EmailDeliveryStatus {
  if (invoice.emailStatus === 'pending' || invoice.emailStatus === 'sending' || invoice.emailStatus === 'sent' || invoice.emailStatus === 'failed') {
    return invoice.emailStatus;
  }
  const legacyStatus = invoice.status as string | undefined;
  return legacyStatus === 'sent' || Boolean(invoice.sentAt) ? 'sent' : 'pending';
}

function normalizePaymentStatus(value: Invoice['paymentStatus'] | undefined): PaymentStatus {
  if (value === 'paid' || value === 'partially_paid' || value === 'overdue') return value;
  return 'unpaid';
}

function normalizeInvoice(invoice: Invoice): Invoice {
  const pdfStatus = normalizePdfStatus(invoice.pdfStatus ?? invoice.status);
  return {
    ...invoice,
    pdfStatus,
    emailStatus: normalizeEmailStatus(invoice),
    paymentStatus: normalizePaymentStatus(invoice.paymentStatus),
    status: pdfStatus,
  };
}

export async function uploadReceiptImage(
  data: UploadReceiptRequest
): Promise<UploadReceiptResponse> {
  const res = await apiClient.post<UploadReceiptResponse>(
    '/upload-receipt-image',
    data
  );
  return res.data;
}

export async function processOcr(
  data: ProcessOcrRequest
): Promise<ProcessOcrResponse> {
  const res = await apiClient.post<ProcessOcrResponse>('/process-ocr', data);
  return res.data;
}

export async function getReceipt(receiptId: string): Promise<Receipt> {
  const res = await apiClient.get<Receipt>(`/receipts/${receiptId}`);
  return res.data;
}

export async function reviewReceipt(receiptId: string): Promise<ReviewReceiptResponse> {
  const res = await apiClient.post<ReviewReceiptResponse>(`/receipts/${receiptId}/review`);
  console.log('[API] reviewReceipt response:', res.data);
  return res.data;
}

export async function updateReceipt(
  receiptId: string,
  data: {
    merchantName: string;
    merchantAddress?: string | null;
    lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  }
): Promise<Receipt> {
  const res = await apiClient.put<Receipt>(`/receipts/${receiptId}`, data);
  console.log('[API] updateReceipt response:', res.data.status);
  return res.data;
}

export async function generateInvoice(
  data: GenerateInvoiceRequest
): Promise<GenerateInvoiceResponse> {
  const res = await apiClient.post<GenerateInvoiceResponse>('/generate-invoice', data);
  console.log('[API] generateInvoice response:', res.data);
  return res.data;
}

export async function getInvoice(invoiceId: string): Promise<Invoice> {
  const res = await apiClient.get<Invoice>(`/invoices/${invoiceId}`);
  console.log('[API] getInvoice response:', res.data);
  return normalizeInvoice(res.data);
}

export async function listInvoices(): Promise<Invoice[]> {
  const res = await apiClient.get<Invoice[]>('/invoices');
  console.log(`[API] listInvoices: ${res.data.length} invoices`);
  return res.data.map(normalizeInvoice);
}

export async function sendInvoiceEmail(params: {
  invoiceId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ emailId: string; emailStatus: string; status?: string; sentAt: string }> {
  const res = await apiClient.post('/send-email', params);
  console.log('[API] sendInvoiceEmail response:', res.data);
  return res.data;
}
