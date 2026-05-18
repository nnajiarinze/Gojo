-- Migration: 006_invoice-status-separation
-- Separate PDF generation, email delivery, and payment lifecycle state.

DO $$ BEGIN
  CREATE TYPE invoice_pdf_status AS ENUM ('draft', 'generating_pdf', 'ready', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE invoice_email_status AS ENUM ('pending', 'sending', 'sent', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE invoice_payment_status AS ENUM ('unpaid', 'paid', 'partially_paid', 'overdue');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS pdf_status invoice_pdf_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS email_status invoice_email_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_status invoice_payment_status NOT NULL DEFAULT 'unpaid';

UPDATE invoices
SET
  pdf_status = CASE
    WHEN status = 'generating_pdf' THEN 'generating_pdf'::invoice_pdf_status
    WHEN status = 'ready' THEN 'ready'::invoice_pdf_status
    WHEN status = 'sent' THEN 'ready'::invoice_pdf_status
    WHEN status = 'failed' THEN 'failed'::invoice_pdf_status
    ELSE 'draft'::invoice_pdf_status
  END,
  email_status = CASE
    WHEN status = 'sent' OR sent_at IS NOT NULL THEN 'sent'::invoice_email_status
    ELSE email_status
  END,
  payment_status = COALESCE(payment_status, 'unpaid'::invoice_payment_status);

CREATE INDEX IF NOT EXISTS idx_invoices_pdf_status ON invoices(pdf_status);
CREATE INDEX IF NOT EXISTS idx_invoices_email_status ON invoices(email_status);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);

COMMENT ON COLUMN invoices.status IS 'Deprecated legacy PDF status. Use pdf_status, email_status, and payment_status instead.';
COMMENT ON COLUMN invoices.pdf_status IS 'PDF/document generation lifecycle only.';
COMMENT ON COLUMN invoices.email_status IS 'Email delivery lifecycle only.';
COMMENT ON COLUMN invoices.payment_status IS 'Invoice payment/business lifecycle only.';
