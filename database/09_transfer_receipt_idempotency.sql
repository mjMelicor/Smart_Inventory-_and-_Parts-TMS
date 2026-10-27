-- Add an append-only event record for each accepted receipt request.
-- This script is additive and must be applied before deploying the API code
-- that writes to transfer_receipt_events. It is intentionally not executed here.

BEGIN;

CREATE TABLE transfer_receipt_events (
    idempotency_key UUID PRIMARY KEY,
    transfer_item_id BIGINT NOT NULL,
    quantity INTEGER NOT NULL,
    received_by_user_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_transfer_receipt_events_quantity_positive
        CHECK (quantity > 0),
    CONSTRAINT fk_transfer_receipt_events_item
        FOREIGN KEY (transfer_item_id)
        REFERENCES transfer_items (transfer_item_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_receipt_events_user
        FOREIGN KEY (received_by_user_id)
        REFERENCES users (user_id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_transfer_receipt_events_item
    ON transfer_receipt_events (transfer_item_id);

CREATE INDEX idx_transfer_receipt_events_user
    ON transfer_receipt_events (received_by_user_id);

-- Receipt events are accessed by the trusted backend connection only. Keep
-- the new public-schema table inaccessible to direct Supabase API roles.
ALTER TABLE transfer_receipt_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE transfer_receipt_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE transfer_receipt_events TO service_role;

COMMIT;
