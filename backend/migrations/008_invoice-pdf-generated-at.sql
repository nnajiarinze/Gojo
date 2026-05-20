-- Migration: 008_invoice-pdf-generated-at
-- Track when an immutable invoice PDF artifact was first generated.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ;

UPDATE invoices
SET pdf_generated_at = COALESCE(pdf_generated_at, updated_at, created_at)
WHERE pdf_url IS NOT NULL
  AND pdf_generated_at IS NULL;

COMMENT ON COLUMN invoices.pdf_generated_at IS 'Timestamp when the immutable invoice PDF artifact was first generated.';
