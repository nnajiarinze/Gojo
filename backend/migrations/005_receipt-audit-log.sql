-- Create receipt_audit_log table (was referenced in code but never created)
CREATE TABLE IF NOT EXISTS receipt_audit_log (
  id UUID PRIMARY KEY,
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  event VARCHAR(100) NOT NULL,
  previous_status VARCHAR(50),
  new_status VARCHAR(50),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_audit_log_receipt_id ON receipt_audit_log(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_audit_log_created_at ON receipt_audit_log(created_at);
