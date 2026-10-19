-- ============================================
-- DATABASE INDEXES
-- ============================================

-- USERS
CREATE INDEX idx_users_branch_id
ON users(branch_id);


-- PARTS MASTER
CREATE INDEX idx_parts_master_supplier_id
ON parts_master(supplier_id);


-- WORK ORDERS
CREATE INDEX idx_work_orders_branch_id
ON work_orders(branch_id);

CREATE INDEX idx_work_orders_technician_id
ON work_orders(assigned_technician_id);


-- WORK ORDER ITEMS
CREATE INDEX idx_work_order_items_work_order_id
ON work_order_items(work_order_id);

CREATE INDEX idx_work_order_items_part_id
ON work_order_items(part_id);


-- TRANSFER REQUESTS
CREATE INDEX idx_transfer_requests_source_branch
ON transfer_requests(source_branch_id);

CREATE INDEX idx_transfer_requests_destination_branch
ON transfer_requests(destination_branch_id);

CREATE INDEX idx_transfer_requests_requested_by
ON transfer_requests(requested_by_user_id);

CREATE INDEX idx_transfer_requests_approved_by
ON transfer_requests(approved_by_user_id);


-- TRANSFER ITEMS
CREATE INDEX idx_transfer_items_transfer_id
ON transfer_items(transfer_id);

CREATE INDEX idx_transfer_items_part_id
ON transfer_items(part_id);


-- INVENTORY
CREATE INDEX idx_inventory_branch_id
ON inventory(branch_id);

CREATE INDEX idx_inventory_part_id
ON inventory(part_id);


-- AUDIT LOGS
CREATE INDEX idx_audit_logs_branch_id
ON audit_logs(branch_id);

CREATE INDEX idx_audit_logs_user_id
ON audit_logs(performed_by_user_id);