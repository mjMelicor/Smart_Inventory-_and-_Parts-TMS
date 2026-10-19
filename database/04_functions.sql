-- ============================================
-- DATABASE FUNCTIONS
-- ============================================

-- 1. DEDUCT INVENTORY
CREATE OR REPLACE FUNCTION deduct_inventory(
    p_branch_id BIGINT,
    p_part_id BIGINT,
    p_quantity INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    current_stock INTEGER;
BEGIN

    -- Check that the requested quantity is valid
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero.';
    END IF;


    -- Get the current stock
    SELECT quantity_on_hand
    INTO current_stock
    FROM inventory
    WHERE branch_id = p_branch_id
      AND part_id = p_part_id
    FOR UPDATE;


    -- Check whether inventory exists
    IF current_stock IS NULL THEN
        RAISE EXCEPTION
            'No inventory record exists for this branch and part.';
    END IF;


    -- Prevent negative inventory
    IF current_stock < p_quantity THEN
        RAISE EXCEPTION
            'Insufficient inventory. Available: %, Requested: %.',
            current_stock,
            p_quantity;
    END IF;


    -- Deduct the inventory
    UPDATE inventory
    SET quantity_on_hand = quantity_on_hand - p_quantity,
        updated_at = NOW()
    WHERE branch_id = p_branch_id
      AND part_id = p_part_id;

END;
$$;

-- 2. ADD INVENTORY
CREATE OR REPLACE FUNCTION add_inventory(
    p_branch_id BIGINT,
    p_part_id BIGINT,
    p_quantity INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN

    -- Check that the quantity is valid
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero.';
    END IF;


    -- Check that the inventory record exists
    IF NOT EXISTS (
        SELECT 1
        FROM inventory
        WHERE branch_id = p_branch_id
          AND part_id = p_part_id
    ) THEN
        RAISE EXCEPTION
            'No inventory record exists for this branch and part.';
    END IF;


    -- Add the inventory
    UPDATE inventory
    SET quantity_on_hand = quantity_on_hand + p_quantity,
        updated_at = NOW()
    WHERE branch_id = p_branch_id
      AND part_id = p_part_id;

END;
$$;

-- 3. TRANSFER INVENTORY BETWEEN BRANCHES
CREATE OR REPLACE FUNCTION transfer_inventory(
    p_source_branch_id BIGINT,
    p_destination_branch_id BIGINT,
    p_part_id BIGINT,
    p_quantity INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    source_stock INTEGER;
BEGIN

    -- Check that the quantity is valid
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Transfer quantity must be greater than zero.';
    END IF;


    -- Prevent transferring to the same branch
    IF p_source_branch_id = p_destination_branch_id THEN
        RAISE EXCEPTION
            'Source and destination branches must be different.';
    END IF;


    -- Check source inventory and lock the row
    SELECT quantity_on_hand
    INTO source_stock
    FROM inventory
    WHERE branch_id = p_source_branch_id
      AND part_id = p_part_id
    FOR UPDATE;


    -- Check whether source inventory exists
    IF source_stock IS NULL THEN
        RAISE EXCEPTION
            'No source inventory record exists for this branch and part.';
    END IF;


    -- Check whether source has enough stock
    IF source_stock < p_quantity THEN
        RAISE EXCEPTION
            'Insufficient source inventory. Available: %, Requested: %.',
            source_stock,
            p_quantity;
    END IF;


    -- Check whether destination inventory exists
    IF NOT EXISTS (
        SELECT 1
        FROM inventory
        WHERE branch_id = p_destination_branch_id
          AND part_id = p_part_id
    ) THEN
        RAISE EXCEPTION
            'No destination inventory record exists for this branch and part.';
    END IF;


    -- Deduct from source branch
    UPDATE inventory
    SET quantity_on_hand = quantity_on_hand - p_quantity,
        updated_at = NOW()
    WHERE branch_id = p_source_branch_id
      AND part_id = p_part_id;


    -- Add to destination branch
    UPDATE inventory
    SET quantity_on_hand = quantity_on_hand + p_quantity,
        updated_at = NOW()
    WHERE branch_id = p_destination_branch_id
      AND part_id = p_part_id;

END;
$$;