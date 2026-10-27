-- Additive upgrade for the Express/Prisma API workflow.
-- Run after 01_create_tables.sql through 06_rls_policies.sql.

ALTER TABLE transfer_requests
    DROP CONSTRAINT IF EXISTS chk_transfer_requests_status;

ALTER TABLE transfer_requests
    ADD CONSTRAINT chk_transfer_requests_status
    CHECK (status IN (
        'pending',
        'approved',
        'rejected',
        'dispatched',
        'partially_received',
        'completed',
        'cancelled'
    ));

CREATE TABLE IF NOT EXISTS setup_codes (
    setup_code_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    role VARCHAR(30) NOT NULL CHECK (role IN ('branch_manager', 'head_office_admin')),
    branch_id BIGINT REFERENCES branches(branch_id) ON DELETE CASCADE,
    created_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    CONSTRAINT chk_setup_code_role_branch
        CHECK (
            (role = 'branch_manager' AND branch_id IS NOT NULL)
            OR (role = 'head_office_admin' AND branch_id IS NULL)
        )
);

CREATE INDEX IF NOT EXISTS idx_setup_codes_expires_at
    ON setup_codes(expires_at);

-- Atomically reserve available source stock when a transfer request is created.
CREATE OR REPLACE FUNCTION reserve_inventory(
    p_branch_id BIGINT,
    p_part_id BIGINT,
    p_quantity INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Reservation quantity must be greater than zero.';
    END IF;

    UPDATE inventory
    SET quantity_reserved = quantity_reserved + p_quantity,
        updated_at = NOW()
    WHERE branch_id = p_branch_id
      AND part_id = p_part_id
      AND quantity_on_hand - quantity_reserved >= p_quantity;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient available inventory to reserve.';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION release_reserved_inventory(
    p_branch_id BIGINT,
    p_part_id BIGINT,
    p_quantity INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Release quantity must be greater than zero.';
    END IF;

    UPDATE inventory
    SET quantity_reserved = quantity_reserved - p_quantity,
        updated_at = NOW()
    WHERE branch_id = p_branch_id
      AND part_id = p_part_id
      AND quantity_reserved >= p_quantity;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reserved inventory is insufficient to release.';
    END IF;
END;
$$;

-- Dispatch only stock that was previously reserved for the transfer.
CREATE OR REPLACE FUNCTION dispatch_reserved_inventory(
    p_branch_id BIGINT,
    p_part_id BIGINT,
    p_quantity INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Dispatch quantity must be greater than zero.';
    END IF;

    UPDATE inventory
    SET quantity_on_hand = quantity_on_hand - p_quantity,
        quantity_reserved = quantity_reserved - p_quantity,
        updated_at = NOW()
    WHERE branch_id = p_branch_id
      AND part_id = p_part_id
      AND quantity_on_hand >= p_quantity
      AND quantity_reserved >= p_quantity;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reserved inventory is insufficient to dispatch.';
    END IF;
END;
$$;

-- Keep reservation quantities within the physical stock ceiling, including writes
-- made outside the API.
CREATE OR REPLACE FUNCTION enforce_inventory_reservation_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.quantity_reserved > NEW.quantity_on_hand THEN
        RAISE EXCEPTION 'Reserved inventory cannot exceed physical inventory.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_reservation_limit ON inventory;
CREATE TRIGGER trg_inventory_reservation_limit
BEFORE INSERT OR UPDATE OF quantity_on_hand, quantity_reserved ON inventory
FOR EACH ROW
EXECUTE FUNCTION enforce_inventory_reservation_limit();

-- Log all stock changes, including writes made through SQL outside the API.
-- API transactions set app.user_id and app.audit_details locally so the actor and
-- business reason are captured without trusting client-supplied audit records.
CREATE OR REPLACE FUNCTION audit_inventory_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    actor_id BIGINT;
    branch_key BIGINT;
    inventory_key BIGINT;
BEGIN
    actor_id := NULLIF(current_setting('app.user_id', TRUE), '')::BIGINT;
    IF TG_OP = 'DELETE' THEN
        branch_key := OLD.branch_id;
        inventory_key := OLD.inventory_id;
    ELSE
        branch_key := NEW.branch_id;
        inventory_key := NEW.inventory_id;
    END IF;

    INSERT INTO audit_logs (
        table_name,
        operation,
        record_id,
        branch_id,
        performed_by_user_id,
        old_data
    )
    VALUES (
        'inventory',
        TG_OP,
        inventory_key,
        branch_key,
        actor_id,
        jsonb_build_object(
            'old', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
            'new', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
            'details', NULLIF(current_setting('app.audit_details', TRUE), '')::JSONB
        )
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_audit ON inventory;
CREATE TRIGGER trg_inventory_audit
AFTER INSERT OR UPDATE OR DELETE ON inventory
FOR EACH ROW
EXECUTE FUNCTION audit_inventory_change();
