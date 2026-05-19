import { randomUUID } from 'node:crypto';
import { query, queryOne, pool } from '../config/database.js';
import { Receipt, LineItem, ReceiptStatus } from '../types/domain.js';
import { getDefaultOrganizationIdForUser } from './organization.repository.js';

// ─── Row types (snake_case from Postgres) ───

interface ReceiptRow {
  id: string;
  user_id: string;
  organization_id: string;
  image_url: string;
  image_key: string;
  merchant_name: string | null;
  merchant_address: string | null;
  receipt_date: string | null;
  subtotal: string | null;
  tax_amount: string | null;
  total_amount: string | null;
  currency: string;
  status: ReceiptStatus;
  confidence: string | null;
  raw_ocr_response: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface LineItemRow {
  id: string;
  receipt_id: string | null;
  invoice_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  total: string;
  sort_order: number;
}

// ─── Row → Domain mapping ───

function toReceipt(row: ReceiptRow, lineItems: LineItem[]): Receipt {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    imageUrl: row.image_url,
    imageKey: row.image_key,
    merchantName: row.merchant_name,
    merchantAddress: row.merchant_address,
    receiptDate: row.receipt_date,
    subtotal: row.subtotal ? parseFloat(row.subtotal) : null,
    taxAmount: row.tax_amount ? parseFloat(row.tax_amount) : null,
    totalAmount: row.total_amount ? parseFloat(row.total_amount) : null,
    currency: row.currency.trim(),
    lineItems,
    status: row.status,
    confidence: row.confidence ? parseFloat(row.confidence) : null,
    rawOcrResponse: row.raw_ocr_response,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toLineItem(row: LineItemRow): LineItem {
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

// ─── Repository functions ───

export async function createReceipt(
  userId: string,
  imageUrl: string,
  imageKey: string
): Promise<string> {
  const id = randomUUID();
  const organizationId = await getDefaultOrganizationIdForUser(userId);
  await query(
    `INSERT INTO receipts (id, user_id, organization_id, image_url, image_key, status)
     VALUES ($1, $2, $3, $4, $5, 'uploaded')`,
    [id, userId, organizationId, imageUrl, imageKey]
  );
  return id;
}

export async function getReceiptById(
  receiptId: string,
  userId: string
): Promise<Receipt | null> {
  const row = await queryOne<ReceiptRow>(
    `SELECT * FROM receipts WHERE id = $1 AND user_id = $2`,
    [receiptId, userId]
  );
  if (!row) return null;

  const lineItemRows = await query<LineItemRow>(
    `SELECT * FROM line_items WHERE receipt_id = $1 ORDER BY sort_order`,
    [receiptId]
  );

  return toReceipt(row, lineItemRows.map(toLineItem));
}

/**
 * For worker context where we don't have userId (job only has receiptId).
 */
export async function getReceiptByIdInternal(
  receiptId: string
): Promise<Receipt | null> {
  const row = await queryOne<ReceiptRow>(
    `SELECT * FROM receipts WHERE id = $1`,
    [receiptId]
  );
  if (!row) return null;

  const lineItemRows = await query<LineItemRow>(
    `SELECT * FROM line_items WHERE receipt_id = $1 ORDER BY sort_order`,
    [receiptId]
  );

  return toReceipt(row, lineItemRows.map(toLineItem));
}

export async function setProcessing(receiptId: string): Promise<void> {
  await query(
    `UPDATE receipts SET status = 'processing', updated_at = NOW() WHERE id = $1`,
    [receiptId]
  );
}

export async function setExtractedData(
  receiptId: string,
  data: {
    merchantName: string;
    merchantAddress: string;
    receiptDate: string;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    currency: string;
    confidence: number;
    rawOcrResponse: Record<string, unknown>;
    lineItems: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }>;
  }
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update receipt fields
    await client.query(
      `UPDATE receipts SET
        merchant_name = $2,
        merchant_address = $3,
        receipt_date = $4,
        subtotal = $5,
        tax_amount = $6,
        total_amount = $7,
        currency = $8,
        confidence = $9,
        raw_ocr_response = $10,
        status = 'extracted',
        updated_at = NOW()
      WHERE id = $1`,
      [
        receiptId,
        data.merchantName,
        data.merchantAddress,
        data.receiptDate,
        data.subtotal,
        data.taxAmount,
        data.totalAmount,
        data.currency,
        data.confidence,
        JSON.stringify(data.rawOcrResponse),
      ]
    );

    // Delete existing line items (idempotent on retry)
    await client.query(
      `DELETE FROM line_items WHERE receipt_id = $1`,
      [receiptId]
    );

    // Insert line items
    for (let i = 0; i < data.lineItems.length; i++) {
      const li = data.lineItems[i];
      await client.query(
        `INSERT INTO line_items (id, receipt_id, description, quantity, unit_price, total, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), receiptId, li.description, li.quantity, li.unitPrice, li.total, i]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function setFailed(receiptId: string, reason?: string): Promise<void> {
  await query(
    `UPDATE receipts SET
      status = 'failed',
      raw_ocr_response = COALESCE($2::jsonb, raw_ocr_response),
      updated_at = NOW()
    WHERE id = $1`,
    [receiptId, reason ? JSON.stringify({ error: reason }) : null]
  );
}

/**
 * Update receipt data during review. Validates and persists edits,
 * then transitions status to 'reviewed'.
 */
export async function updateReviewedData(
  receiptId: string,
  userId: string,
  data: {
    merchantName: string;
    merchantAddress?: string | null;
    lineItems: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }>;
  }
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock + verify ownership and status
    const result = await client.query(
      `SELECT status, user_id FROM receipts WHERE id = $1 FOR UPDATE`,
      [receiptId]
    );
    if (result.rows.length === 0) throw new Error('Receipt not found');
    if (result.rows[0].user_id !== userId) throw new Error('Access denied');
    if (result.rows[0].status !== 'extracted') {
      throw new Error(`Cannot edit receipt in "${result.rows[0].status}" state, must be "extracted"`);
    }

    // Validate line item math
    for (const li of data.lineItems) {
      const expected = Math.round(li.quantity * li.unitPrice * 100) / 100;
      if (Math.abs(li.total - expected) > 0.01) {
        throw new Error(
          `Line item "${li.description}" total ${li.total} != quantity(${li.quantity}) × unitPrice(${li.unitPrice}) = ${expected}`
        );
      }
    }

    const subtotal = Math.round(data.lineItems.reduce((s, li) => s + li.total, 0) * 100) / 100;

    // Get existing tax info to recalculate total
    const existing = await client.query(
      `SELECT tax_amount FROM receipts WHERE id = $1`,
      [receiptId]
    );
    const taxAmount = existing.rows[0].tax_amount ? parseFloat(existing.rows[0].tax_amount) : 0;
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

    // Update receipt - enforce SEK
    await client.query(
      `UPDATE receipts SET
        merchant_name = $2,
        merchant_address = COALESCE($3, merchant_address),
        subtotal = $4,
        total_amount = $5,
        currency = 'SEK',
        status = 'reviewed',
        updated_at = NOW()
      WHERE id = $1`,
      [receiptId, data.merchantName, data.merchantAddress ?? null, subtotal, totalAmount]
    );

    // Replace line items
    await client.query(`DELETE FROM line_items WHERE receipt_id = $1`, [receiptId]);
    for (let i = 0; i < data.lineItems.length; i++) {
      const li = data.lineItems[i];
      await client.query(
        `INSERT INTO line_items (id, receipt_id, description, quantity, unit_price, total, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), receiptId, li.description, li.quantity, li.unitPrice, li.total, i]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
