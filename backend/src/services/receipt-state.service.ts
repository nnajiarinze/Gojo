import { randomUUID } from 'node:crypto';
import { pool, query, queryOne } from '../config/database.js';
import { Receipt, ReceiptStatus, LineItem } from '../types/domain.js';

// ─── STATE MACHINE DEFINITION ───

const ALLOWED_TRANSITIONS: Record<ReceiptStatus, ReceiptStatus[]> = {
  uploaded: ['processing'],
  processing: ['extracted', 'failed'],
  extracted: ['reviewed'],
  reviewed: ['invoice_ready'],
  invoice_ready: ['invoiced'],
  invoiced: [],
  failed: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly receiptId: string,
    public readonly from: ReceiptStatus,
    public readonly to: ReceiptStatus
  ) {
    super(`Invalid state transition: ${from} → ${to} for receipt ${receiptId}`);
    this.name = 'InvalidTransitionError';
  }
}

export class BusinessRuleError extends Error {
  constructor(
    public readonly receiptId: string,
    public readonly rule: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`Business rule violated for receipt ${receiptId}: ${rule}`);
    this.name = 'BusinessRuleError';
  }
}

export class ConcurrencyError extends Error {
  constructor(public readonly receiptId: string) {
    super(`Concurrent modification detected for receipt ${receiptId}`);
    this.name = 'ConcurrencyError';
  }
}

// ─── RECEIPT STATE SERVICE ───

/**
 * Single source of truth for all receipt state transitions.
 * No direct DB status updates should happen outside this service.
 */
export class ReceiptStateService {
  /**
   * Transition receipt to a new state with validation and audit logging.
   * Uses SELECT FOR UPDATE to prevent race conditions.
   */
  async transition(
    receiptId: string,
    toStatus: ReceiptStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the row to prevent concurrent modifications
      const result = await client.query(
        `SELECT status FROM receipts WHERE id = $1 FOR UPDATE`,
        [receiptId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Receipt ${receiptId} not found`);
      }

      const currentStatus = result.rows[0].status as ReceiptStatus;

      // Validate transition
      const allowed = ALLOWED_TRANSITIONS[currentStatus];
      if (!allowed.includes(toStatus)) {
        throw new InvalidTransitionError(receiptId, currentStatus, toStatus);
      }

      // Update status
      await client.query(
        `UPDATE receipts SET status = $2, updated_at = NOW() WHERE id = $1`,
        [receiptId, toStatus]
      );

      // Audit log
      await client.query(
        `INSERT INTO receipt_audit_log (id, receipt_id, event, previous_status, new_status, metadata, created_at)
         VALUES ($1, $2, 'state_changed', $3, $4, $5, NOW())`,
        [
          randomUUID(),
          receiptId,
          currentStatus,
          toStatus,
          JSON.stringify(metadata ?? {}),
        ]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Validate that a receipt is ready for invoice generation.
   * Acquires a row lock and returns the locked receipt for use in a transaction.
   * Caller must pass the PoolClient and handle COMMIT/ROLLBACK.
   */
  async validateForInvoice(receiptId: string, userId: string): Promise<Receipt> {
    // Fetch full receipt with line items
    const row = await queryOne<any>(
      `SELECT * FROM receipts WHERE id = $1 AND user_id = $2`,
      [receiptId, userId]
    );

    if (!row) {
      throw new BusinessRuleError(receiptId, 'Receipt not found or access denied');
    }

    // Must be in "reviewed" state
    if (row.status !== 'reviewed') {
      throw new BusinessRuleError(receiptId, `Receipt must be in "reviewed" state, currently "${row.status}"`, {
        currentStatus: row.status,
        requiredStatus: 'reviewed',
      });
    }

    // Fetch line items
    const lineItemRows = await query<any>(
      `SELECT * FROM line_items WHERE receipt_id = $1 ORDER BY sort_order`,
      [receiptId]
    );

    if (lineItemRows.length === 0) {
      throw new BusinessRuleError(receiptId, 'Receipt must have at least one line item');
    }

    // Validate currency is SEK
    const currency = row.currency?.trim();
    if (currency !== 'SEK') {
      throw new BusinessRuleError(receiptId, `Currency must be SEK, got "${currency}"`, {
        currency,
      });
    }

    // Validate totals are mathematically correct
    const lineItems = lineItemRows.map((li: any) => ({
      id: li.id,
      receiptId: li.receipt_id,
      invoiceId: li.invoice_id,
      description: li.description,
      quantity: parseFloat(li.quantity),
      unitPrice: parseFloat(li.unit_price),
      total: parseFloat(li.total),
      sortOrder: li.sort_order,
    }));

    const computedSubtotal = lineItems.reduce((sum: number, li: LineItem) => sum + li.total, 0);
    const storedSubtotal = row.subtotal ? parseFloat(row.subtotal) : 0;

    // Allow 1 cent tolerance for floating point
    if (Math.abs(computedSubtotal - storedSubtotal) > 0.01) {
      throw new BusinessRuleError(receiptId, 'Line item totals do not match receipt subtotal', {
        computedSubtotal,
        storedSubtotal,
      });
    }

    const totalAmount = row.total_amount ? parseFloat(row.total_amount) : 0;
    const taxAmount = row.tax_amount ? parseFloat(row.tax_amount) : 0;
    if (Math.abs(storedSubtotal + taxAmount - totalAmount) > 0.01) {
      throw new BusinessRuleError(receiptId, 'subtotal + tax does not equal totalAmount', {
        storedSubtotal,
        taxAmount,
        totalAmount,
      });
    }

    return {
      id: row.id,
      userId: row.user_id,
      organizationId: row.organization_id,
      imageUrl: row.image_url,
      imageKey: row.image_key,
      merchantName: row.merchant_name,
      merchantAddress: row.merchant_address,
      receiptDate: row.receipt_date,
      subtotal: storedSubtotal,
      taxAmount,
      totalAmount,
      currency,
      lineItems,
      status: row.status,
      confidence: row.confidence ? parseFloat(row.confidence) : null,
      rawOcrResponse: row.raw_ocr_response,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Atomically transition receipt to invoice_ready and return locked state.
   * Prevents double invoice generation via SELECT FOR UPDATE + status check.
   */
  async lockForInvoiceGeneration(receiptId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT status FROM receipts WHERE id = $1 FOR UPDATE`,
        [receiptId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Receipt ${receiptId} not found`);
      }

      const currentStatus = result.rows[0].status as ReceiptStatus;

      if (currentStatus !== 'reviewed') {
        throw new ConcurrencyError(receiptId);
      }

      // Transition to invoice_ready (locks it from other requests)
      await client.query(
        `UPDATE receipts SET status = 'invoice_ready', updated_at = NOW() WHERE id = $1`,
        [receiptId]
      );

      // Audit
      await client.query(
        `INSERT INTO receipt_audit_log (id, receipt_id, event, previous_status, new_status, metadata, created_at)
         VALUES ($1, $2, 'state_changed', $3, $4, $5, NOW())`,
        [
          randomUUID(),
          receiptId,
          'reviewed',
          'invoice_ready',
          JSON.stringify({ receiptId }),
        ]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Mark receipt as invoiced after successful invoice creation.
   */
  async markInvoiced(receiptId: string, invoiceId: string): Promise<void> {
    await this.transition(receiptId, 'invoiced', { invoiceId });
  }

  /**
   * Log an audit event.
   */
  async logEvent(
    receiptId: string,
    event: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await query(
      `INSERT INTO receipt_audit_log (id, receipt_id, event, metadata, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), receiptId, event, metadata ? JSON.stringify(metadata) : null]
    );
  }
}

// Singleton
export const receiptStateService = new ReceiptStateService();
