import { Invoice, LineItem } from '../types/domain.js';
import * as invoiceRepo from '../repositories/invoice.repository.js';
import { getInvoiceQueue } from '../queues/index.js';

/**
 * Invoice service — thin layer over the invoice repository.
 *
 * KEY DESIGN PRINCIPLE: Invoices are immutable after creation.
 * They snapshot receipt data at generation time and are never
 * affected by future receipt edits or status changes.
 */

export async function createInvoice(params: {
  userId: string;
  receiptId: string;
  customerId: string;
  dueDate: string;
  notes?: string;
  lineItems: Omit<LineItem, 'id' | 'receiptId' | 'invoiceId' | 'sortOrder'>[];
  taxRate: number;
  taxAmount?: number;
  subtotal?: number;
  totalAmount?: number;
  legalMetadata?: { kontrollenhet: string; orgNumber: string; companyName: string; address: string };
}): Promise<{ invoiceId: string; invoiceNumber: string }> {
  // Persist invoice + line items atomically in PostgreSQL
  const result = await invoiceRepo.createInvoice(params);

  // Enqueue PDF generation (invoice worker will mark it 'ready')
  try {
    await getInvoiceQueue().add('generate', {
      invoiceId: result.invoiceId,
      userId: params.userId,
    });
    console.log(`[InvoiceService] PDF job enqueued for ${result.invoiceId}`);
  } catch (err) {
    // If queue fails, still return the invoice — PDF can be retried
    console.error(`[InvoiceService] Failed to enqueue PDF job:`, err);
  }

  return result;
}

export async function getInvoiceById(
  invoiceId: string,
  userId: string
): Promise<Invoice | null> {
  // Retrieval is fully independent of receipt lifecycle
  return invoiceRepo.getInvoiceById(invoiceId, userId);
}

export async function listInvoices(userId: string): Promise<Invoice[]> {
  return invoiceRepo.listInvoicesByUser(userId);
}
