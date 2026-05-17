import { apiClient } from './client';
import type {
  UploadReceiptRequest,
  UploadReceiptResponse,
  ProcessOcrRequest,
  ProcessOcrResponse,
  Receipt,
  Invoice,
  ReviewReceiptResponse,
  GenerateInvoiceRequest,
  GenerateInvoiceResponse,
} from '../types/api';

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
  return res.data;
}

export async function listInvoices(): Promise<Invoice[]> {
  const res = await apiClient.get<Invoice[]>('/invoices');
  console.log(`[API] listInvoices: ${res.data.length} invoices`);
  return res.data;
}

export async function sendInvoiceEmail(params: {
  invoiceId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ emailId: string; status: string; sentAt: string }> {
  const res = await apiClient.post('/send-email', params);
  console.log('[API] sendInvoiceEmail response:', res.data);
  return res.data;
}
