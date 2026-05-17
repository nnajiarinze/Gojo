-- Add new receipt status values for the state machine
ALTER TYPE receipt_status ADD VALUE IF NOT EXISTS 'reviewed';
ALTER TYPE receipt_status ADD VALUE IF NOT EXISTS 'invoice_ready';
ALTER TYPE receipt_status ADD VALUE IF NOT EXISTS 'invoiced';

-- Add new event types
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'state_changed';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'invoice_created';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'invoice_failed';
