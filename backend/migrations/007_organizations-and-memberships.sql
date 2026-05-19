-- Migration: 007_organizations-and-memberships
-- Add restaurant/business tenant model and scope invoices, receipts, and customers by organization.

DO $$ BEGIN
  CREATE TYPE organization_member_role AS ENUM ('owner', 'admin', 'staff');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  org_number TEXT UNIQUE,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role organization_member_role NOT NULL DEFAULT 'staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

INSERT INTO organizations (id, name, slug, org_number, address)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Gojo Restaurant',
  'gojo-restaurant',
  '559000-0000',
  'Stockholm, Sverige'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  org_number = EXCLUDED.org_number,
  address = EXCLUDED.address;

INSERT INTO organization_members (organization_id, user_id, role)
SELECT '11111111-1111-1111-1111-111111111111', id, 'owner'::organization_member_role
FROM users
ON CONFLICT (organization_id, user_id) DO NOTHING;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

UPDATE customers
SET organization_id = '11111111-1111-1111-1111-111111111111'
WHERE organization_id IS NULL;

UPDATE receipts
SET organization_id = '11111111-1111-1111-1111-111111111111'
WHERE organization_id IS NULL;

UPDATE invoices
SET organization_id = COALESCE(
  organization_id,
  (SELECT receipts.organization_id FROM receipts WHERE receipts.id = invoices.receipt_id),
  '11111111-1111-1111-1111-111111111111'
)
WHERE organization_id IS NULL;

ALTER TABLE customers
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE receipts
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE invoices
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_organization_id ON customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_receipts_organization_id ON receipts(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_organization_id ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_organization_created_at ON invoices(organization_id, created_at DESC);

COMMENT ON TABLE organizations IS 'Business tenant boundary. One restaurant/business owns its invoices, receipts, and customers.';
COMMENT ON TABLE organization_members IS 'Users who can access a restaurant/business tenant.';
COMMENT ON COLUMN invoices.organization_id IS 'Tenant organization that owns this invoice.';
COMMENT ON COLUMN receipts.organization_id IS 'Tenant organization that owns this receipt.';
COMMENT ON COLUMN customers.organization_id IS 'Tenant organization that owns this customer.';
