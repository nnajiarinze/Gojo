-- Add legal metadata JSONB column to invoices for Swedish compliance
-- Stores: kontrollenhet, orgNumber, companyName, address, receiptNumber
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS legal_metadata JSONB;

-- Default currency to SEK (was USD)
ALTER TABLE invoices ALTER COLUMN currency SET DEFAULT 'SEK';
