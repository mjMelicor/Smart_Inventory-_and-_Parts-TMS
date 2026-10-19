-- ============================================
-- DATABASE TRIGGERS
-- ============================================


-- 1. FUNCTION TO UPDATE updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


-- 2. INVENTORY updated_at TRIGGER
CREATE TRIGGER trg_inventory_updated_at
BEFORE UPDATE ON inventory
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 3. TRANSFER REQUESTS updated_at TRIGGER
CREATE TRIGGER trg_transfer_requests_updated_at
BEFORE UPDATE ON transfer_requests
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();