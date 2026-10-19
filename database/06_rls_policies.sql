-- ============================================
-- RLS VERIFICATION
-- ============================================

SELECT
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================
-- RLS POLICIES
-- ============================================

-- 1. BRANCHES

CREATE POLICY branches_select_authenticated
ON branches
FOR SELECT  
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM users
        WHERE users.email = auth.jwt() ->> 'email'
          AND users.is_active = TRUE
    )
);

-- 2. PARTS MASTER

CREATE POLICY parts_master_select_authenticated
ON parts_master
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM users
        WHERE users.email = auth.jwt() ->> 'email'
          AND users.is_active = TRUE
    )
);

-- 3. INVENTORY

CREATE POLICY inventory_select_authenticated
ON inventory
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM users
        WHERE users.email = auth.jwt() ->> 'email'
          AND users.is_active = TRUE
    )   
);

-- 4. WORK ORDERS

CREATE POLICY work_orders_select_authenticated
ON work_orders
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM users
        WHERE users.email = auth.jwt() ->> 'email'
          AND users.is_active = TRUE
    )
);

-- 5. USERS

CREATE POLICY users_select_authenticated
ON users
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM users AS u
        WHERE u.email = auth.jwt() ->> 'email'
          AND u.is_active = TRUE
    )
);

-- 6. WORK ORDER ITEMS

CREATE POLICY work_order_items_select_authenticated
ON work_order_items
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM users AS u
        WHERE u.email = auth.jwt() ->> 'email'
          AND u.is_active = TRUE
    )
);

-- 7. TRANSFER REQUESTS

CREATE POLICY transfer_requests_select_authenticated
ON transfer_requests
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM users AS u
        WHERE u.email = auth.jwt() ->> 'email'
          AND u.is_active = TRUE
    )
);

-- 8. TRANSFER ITEMS

CREATE POLICY transfer_items_select_authenticated
ON transfer_items
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM users AS u
        WHERE u.email = auth.jwt() ->> 'email'
          AND u.is_active = TRUE
    )
);

-- 9. SUPPLIERS

CREATE POLICY suppliers_select_authenticated
ON suppliers
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM users AS u
        WHERE u.email = auth.jwt() ->> 'email'
          AND u.is_active = TRUE
    )
);

-- 10. AUDIT LOGS

CREATE POLICY audit_logs_select_authenticated
ON audit_logs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM users AS u
        WHERE u.email = auth.jwt() ->> 'email'
          AND u.is_active = TRUE
    )
);