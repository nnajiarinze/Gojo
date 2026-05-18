import { query, queryOne, pool } from '../config/database.js';
import { EmailDeliveryStatus, Invoice, InvoicePdfStatus, LineItem, PaymentStatus } from '../types/domain.js';
import { randomUUID } from 'node:crypto';

// ─── HELPERS ────────────────────────────────────────────────────────────────

function rowToInvoice(row: any, lineItems: LineItem[]): Invoice {
  const pdfStatus = normalizePdfStatus(row.pdf_status ?? row.status);
  const emailStatus = normalizeEmailStatus(row.email_status ?? (row.status === 'sent' || row.sent_at ? 'sent' : 'pending'));
  const paymentStatus = normalizePaymentStatus(row.payment_status ?? 'unpaid');
  return {
    id: row.id,
    userId: row.user_id,
    receiptId: row.receipt_id,
    customerId: row.customer_id,
    invoiceNumber: row.invoice_number,
    issueDate: row.issue_date instanceof Date
      ? row.issue_date.toISOString().split('T')[0]
      : String(row.issue_date),
    dueDate: row.due_date instanceof Date
      ? row.due_date.toISOString().split('T')[0]
      : String(row.due_date),
    lineItems,
    subtotal: parseFloat(row.subtotal),
    taxRate: parseFloat(row.tax_rate),
    taxAmount: parseFloat(row.tax_amount),
    totalAmount: parseFloat(row.total_amount),
    currency: row.currency?.trim() ?? 'SEK',
    notes: row.notes,
    pdfUrl: row.pdf_url,
    pdfStatus,
    emailStatus,
    paymentStatus,
    status: pdfStatus,
    legalMetadata: row.legal_metadata ?? null,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePdfStatus(value: string | null | undefined): InvoicePdfStatus {
  if (value === 'sent') return 'ready';
  if (value === 'draft' || value === 'generating_pdf' || value === 'ready' || value === 'failed') return value;
  return 'draft';
}

function normalizeEmailStatus(value: string | null | undefined): EmailDeliveryStatus {
  if (value === 'pending' || value === 'sending' || value === 'sent' || value === 'failed') return value;
  return 'pending';
}

function normalizePaymentStatus(value: string | null | undefined): PaymentStatus {
  if (value === 'unpaid' || value === 'paid' || value === 'partially_paid' || value === 'overdue') return value;
  return 'unpaid';
}

function rowToLineItem(row: any): LineItem {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    invoiceId: row.invoice_id,
    description: row.description,
    quantity: parseFloat(row.quantity),
    unitPrice: parseFloat(row.unit_price),
    total: parseFloat(row.total),
    sortOrder: row.sort_order,
  };
}

// ─── NEXT INVOICE NUMBER ────────────────────────────────────────────────────

async function nextInvoiceNumber(): Promise<string> {
  const row = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM invoices`
  );
  const num = parseInt(row?.cnt ?? '0', 10) + 1;
  return `INV-${String(num).padStart(6, '0')}`;
}

// ─── CREATE ─────────────────────────────────────────────────────────────────

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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invoiceId = randomUUID();
    const invoiceNumber = await nextInvoiceNumber();

    // Use actual parsed receipt values (Netto, Moms, Totalt) when provided.
    // These come directly from the scanned receipt text and are the source of truth.
    // Only fall back to computation from line items if parsed values are missing.
    const lineItemsTotal = params.lineItems.reduce((sum, li) => sum + li.total, 0);
    const taxAmount = params.taxAmount != null
      ? Math.round(params.taxAmount * 100) / 100
      : Math.round(lineItemsTotal * params.taxRate) / 100;
    const subtotal = params.subtotal != null
      ? Math.round(params.subtotal * 100) / 100
      : Math.round((lineItemsTotal - taxAmount) * 100) / 100;
    const totalAmount = params.totalAmount != null
      ? Math.round(params.totalAmount * 100) / 100
      : lineItemsTotal;
    console.log(`[InvoiceRepo] Netto: ${subtotal} (${params.subtotal != null ? 'from receipt' : 'computed'}), Moms: ${taxAmount} (${params.taxAmount != null ? 'from receipt' : 'computed'}), Totalt: ${totalAmount} (${params.totalAmount != null ? 'from receipt' : 'computed'})`);

    // Invoice is immutable after creation — it snapshots receipt data
    // at this point and is never affected by future receipt edits.
    await client.query(
      `INSERT INTO invoices (id, user_id, receipt_id, customer_id, invoice_number,
         issue_date, due_date, subtotal, tax_rate, tax_amount, total_amount,
         currency, notes, status, pdf_status, email_status, payment_status, legal_metadata)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, $10, 'SEK', $11, 'generating_pdf', 'generating_pdf', 'pending', 'unpaid', $12)`,
      [
        invoiceId, params.userId, params.receiptId, params.customerId,
        invoiceNumber, params.dueDate, subtotal, params.taxRate,
        taxAmount, totalAmount, params.notes ?? null,
        params.legalMetadata ? JSON.stringify(params.legalMetadata) : null,
      ]
    );

    // Insert line items — snapshot of receipt line items at invoice creation time
    for (let i = 0; i < params.lineItems.length; i++) {
      const li = params.lineItems[i];
      await client.query(
        `INSERT INTO line_items (id, invoice_id, description, quantity, unit_price, total, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), invoiceId, li.description, li.quantity, li.unitPrice, li.total, i]
      );
    }

    await client.query('COMMIT');
    return { invoiceId, invoiceNumber };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── GET BY ID ──────────────────────────────────────────────────────────────

export async function getInvoiceById(
  invoiceId: string,
  userId: string
): Promise<Invoice | null> {
  // Invoice retrieval is independent of receipt state.
  // The invoice is a self-contained, immutable record.
  const row = await queryOne<any>(
    `SELECT * FROM invoices WHERE id = $1 AND user_id = $2`,
    [invoiceId, userId]
  );
  if (!row) return null;

  const liRows = await query<any>(
    `SELECT * FROM line_items WHERE invoice_id = $1 ORDER BY sort_order`,
    [invoiceId]
  );

  return rowToInvoice(row, liRows.map(rowToLineItem));
}

// ─── LIST BY USER ───────────────────────────────────────────────────────────

export async function listInvoicesByUser(userId: string): Promise<Invoice[]> {
  const rows = await query<any>(
    `SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  const invoices: Invoice[] = [];
  for (const row of rows) {
    const liRows = await query<any>(
      `SELECT * FROM line_items WHERE invoice_id = $1 ORDER BY sort_order`,
      [row.id]
    );
    invoices.push(rowToInvoice(row, liRows.map(rowToLineItem)));
  }
  return invoices;
}

// ─── UPDATE LIFECYCLE STATUS FIELDS ────────────────────────────────────────

export async function updateInvoicePdfStatus(
  invoiceId: string,
  pdfStatus: InvoicePdfStatus,
  extra?: { pdfUrl?: string }
): Promise<void> {
  const setClauses = ['pdf_status = $2', 'status = $2'];
  const params: unknown[] = [invoiceId, pdfStatus];
  let idx = 3;

  if (extra?.pdfUrl) {
    setClauses.push(`pdf_url = $${idx}`);
    params.push(extra.pdfUrl);
    idx++;
  }

  await query(
    `UPDATE invoices SET ${setClauses.join(', ')} WHERE id = $1`,
    params
  );
}

export async function updateInvoiceEmailStatus(
  invoiceId: string,
  emailStatus: EmailDeliveryStatus,
  extra?: { sentAt?: Date }
): Promise<void> {
  const setClauses = ['email_status = $2'];
  const params: unknown[] = [invoiceId, emailStatus];

  if (extra?.sentAt) {
    setClauses.push('sent_at = $3');
    params.push(extra.sentAt);
  }

  await query(
    `UPDATE invoices SET ${setClauses.join(', ')} WHERE id = $1`,
    params
  );
}

export async function updateInvoicePaymentStatus(
  invoiceId: string,
  paymentStatus: Extract<PaymentStatus, 'unpaid' | 'paid'>
): Promise<void> {
  await query(
    `UPDATE invoices SET payment_status = $2 WHERE id = $1`,
    [invoiceId, paymentStatus]
  );
}

/** @deprecated Use updateInvoicePdfStatus/updateInvoiceEmailStatus instead. */
export async function updateInvoiceStatus(
  invoiceId: string,
  status: string,
  extra?: { pdfUrl?: string; sentAt?: Date }
): Promise<void> {
  if (status === 'sent') {
    await updateInvoiceEmailStatus(invoiceId, 'sent', { sentAt: extra?.sentAt });
    return;
  }
  await updateInvoicePdfStatus(invoiceId, normalizePdfStatus(status), { pdfUrl: extra?.pdfUrl });
}

// ─── LOG EVENT ──────────────────────────────────────────────────────────────

export async function logInvoiceEvent(
  invoiceId: string,
  event: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO invoice_events (id, invoice_id, event, metadata)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), invoiceId, event, metadata ? JSON.stringify(metadata) : null]
  );
}
