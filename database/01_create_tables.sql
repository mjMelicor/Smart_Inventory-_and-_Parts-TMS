-- ============================================
-- SMART INVENTORY AND PARTS TRANSFER SYSTEM
-- DATABASE TABLES
-- ============================================

-- 1. BRANCHES
CREATE TABLE branches (
    branch_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_code VARCHAR(10) NOT NULL UNIQUE,
    branch_name VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    phone VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 2. USERS
CREATE TABLE users (
    user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id BIGINT,
    first_name VARCHAR(75) NOT NULL,
    last_name VARCHAR(75) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(30) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_users_branch
        FOREIGN KEY (branch_id)
        REFERENCES branches(branch_id)
        ON DELETE SET NULL,

    CONSTRAINT chk_users_role
        CHECK (role IN (
            'technician',
            'branch_manager',
            'head_office_admin'
        ))
);


-- 3. SUPPLIERS
CREATE TABLE suppliers (
    supplier_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(150),
    email VARCHAR(255),
    phone VARCHAR(20),
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 4. PARTS MASTER
CREATE TABLE parts_master (
    part_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    supplier_id BIGINT NOT NULL,
    part_number VARCHAR(100) NOT NULL,
    part_name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    unit_of_measure VARCHAR(50) NOT NULL,
    wholesale_cost NUMERIC(12,2) NOT NULL,
    retail_price NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_parts_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES suppliers(supplier_id)
        ON DELETE RESTRICT,

    CONSTRAINT uq_parts_part_number
        UNIQUE (part_number),

    CONSTRAINT chk_parts_wholesale_cost
        CHECK (wholesale_cost >= 0),

    CONSTRAINT chk_parts_retail_price
        CHECK (retail_price >= 0)
);


-- 5. WORK ORDERS
CREATE TABLE work_orders (
    work_order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    work_order_number VARCHAR(50) NOT NULL UNIQUE,

    branch_id BIGINT NOT NULL,

    assigned_technician_id BIGINT,

    customer_name VARCHAR(150) NOT NULL,

    customer_phone VARCHAR(20),

    vehicle_vin_or_plate VARCHAR(50) NOT NULL,

    vehicle_model VARCHAR(150),

    status VARCHAR(30) NOT NULL DEFAULT 'open',

    labor_fee NUMERIC(12,2) NOT NULL DEFAULT 0.00,

    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    completed_at TIMESTAMPTZ,

    CONSTRAINT fk_work_orders_branch
        FOREIGN KEY (branch_id)
        REFERENCES branches(branch_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_work_orders_technician
        FOREIGN KEY (assigned_technician_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL,

    CONSTRAINT chk_work_orders_status
        CHECK (status IN (
            'open',
            'in_progress',
            'completed',
            'cancelled'
        )),

    CONSTRAINT chk_work_orders_labor_fee
        CHECK (labor_fee >= 0),

    CONSTRAINT chk_work_orders_total_amount
        CHECK (total_amount >= 0)
);


-- 6. WORK ORDER ITEMS
CREATE TABLE work_order_items (
    item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    work_order_id BIGINT NOT NULL,

    part_id BIGINT NOT NULL,

    quantity_used INTEGER NOT NULL,

    unit_price_charged NUMERIC(12,2) NOT NULL,

    subtotal NUMERIC(12,2) NOT NULL,

    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_work_order_items_work_order
        FOREIGN KEY (work_order_id)
        REFERENCES work_orders(work_order_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_work_order_items_part
        FOREIGN KEY (part_id)
        REFERENCES parts_master(part_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_work_order_items_quantity
        CHECK (quantity_used > 0),

    CONSTRAINT chk_work_order_items_unit_price
        CHECK (unit_price_charged >= 0),

    CONSTRAINT chk_work_order_items_subtotal
        CHECK (subtotal >= 0)
);


-- 7. TRANSFER REQUESTS
CREATE TABLE transfer_requests (
    transfer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    transfer_code VARCHAR(50) NOT NULL UNIQUE,

    source_branch_id BIGINT NOT NULL,

    destination_branch_id BIGINT NOT NULL,

    requested_by_user_id BIGINT NOT NULL,

    approved_by_user_id BIGINT,

    status VARCHAR(30) NOT NULL DEFAULT 'pending',

    request_notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_transfer_requests_source_branch
        FOREIGN KEY (source_branch_id)
        REFERENCES branches(branch_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_transfer_requests_destination_branch
        FOREIGN KEY (destination_branch_id)
        REFERENCES branches(branch_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_transfer_requests_requested_by
        FOREIGN KEY (requested_by_user_id)
        REFERENCES users(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_transfer_requests_approved_by
        FOREIGN KEY (approved_by_user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL,

    CONSTRAINT chk_transfer_requests_status
        CHECK (status IN (
            'pending',
            'approved',
            'rejected',
            'completed',
            'cancelled'
        )),

    CONSTRAINT chk_transfer_requests_different_branches
        CHECK (source_branch_id <> destination_branch_id)
);


-- 8. TRANSFER ITEMS
CREATE TABLE transfer_items (
    transfer_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    transfer_id BIGINT NOT NULL,

    part_id BIGINT NOT NULL,

    quantity_requested INTEGER NOT NULL,

    quantity_approved INTEGER NOT NULL DEFAULT 0,

    quantity_received INTEGER NOT NULL DEFAULT 0,

    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_transfer_items_transfer
        FOREIGN KEY (transfer_id)
        REFERENCES transfer_requests(transfer_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_transfer_items_part
        FOREIGN KEY (part_id)
        REFERENCES parts_master(part_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_transfer_items_quantity_requested
        CHECK (quantity_requested > 0),

    CONSTRAINT chk_transfer_items_quantity_approved
        CHECK (quantity_approved >= 0),

    CONSTRAINT chk_transfer_items_quantity_received
        CHECK (quantity_received >= 0),

    CONSTRAINT chk_transfer_items_approved_limit
        CHECK (quantity_approved <= quantity_requested),

    CONSTRAINT chk_transfer_items_received_limit
        CHECK (quantity_received <= quantity_approved)
);


-- 9. INVENTORY
CREATE TABLE inventory (
    inventory_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    branch_id BIGINT NOT NULL,

    part_id BIGINT NOT NULL,

    quantity_on_hand INTEGER NOT NULL DEFAULT 0,

    quantity_reserved INTEGER NOT NULL DEFAULT 0,

    reorder_level INTEGER NOT NULL DEFAULT 0,

    shelf_bin_location VARCHAR(100),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_inventory_branch
        FOREIGN KEY (branch_id)
        REFERENCES branches(branch_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_inventory_part
        FOREIGN KEY (part_id)
        REFERENCES parts_master(part_id)
        ON DELETE RESTRICT,

    CONSTRAINT uq_inventory_branch_part
        UNIQUE (branch_id, part_id),

    CONSTRAINT chk_inventory_quantity_on_hand
        CHECK (quantity_on_hand >= 0),

    CONSTRAINT chk_inventory_quantity_reserved
        CHECK (quantity_reserved >= 0),

    CONSTRAINT chk_inventory_reorder_level
        CHECK (reorder_level >= 0),

    CONSTRAINT chk_inventory_reserved_limit
        CHECK (quantity_reserved <= quantity_on_hand)
);


-- 10. AUDIT LOGS
CREATE TABLE audit_logs (
    log_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    table_name VARCHAR(100) NOT NULL,

    operation VARCHAR(30) NOT NULL,

    record_id BIGINT NOT NULL,

    branch_id BIGINT,

    performed_by_user_id BIGINT,

    old_data JSONB,

    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_audit_logs_branch
        FOREIGN KEY (branch_id)
        REFERENCES branches(branch_id)
        ON DELETE SET NULL,

    CONSTRAINT fk_audit_logs_user
        FOREIGN KEY (performed_by_user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL,

    CONSTRAINT chk_audit_logs_operation
        CHECK (operation IN (
            'INSERT',
            'UPDATE',
            'DELETE'
        ))
);