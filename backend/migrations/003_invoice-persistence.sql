-- Migration: 003_invoice-persistence
-- Seed a stub customer for dev/testing, fix currency defaults to SEK

-- Ensure stub user exists first
INSERT INTO users (id, email, name, clerk_id)
VALUES ('00000000-0000-0000-0000-000000000001', 'stub@gojo.dev', 'Stub User', 'clerk-stub')
ON CONFLICT (id) DO NOTHING;

-- Ensure stub customer exists for invoice generation
INSERT INTO customers (id, user_id, name, email, company, address)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Default Customer',
  'customer@gojo.dev',
  'Gojo Restaurant',
  'Stockholm, Sweden'
) ON CONFLICT (id) DO NOTHING;

-- Fix currency defaults to SEK
ALTER TABLE invoices ALTER COLUMN currency SET DEFAULT 'SEK';
ALTER TABLE receipts ALTER COLUMN currency SET DEFAULT 'SEK';
