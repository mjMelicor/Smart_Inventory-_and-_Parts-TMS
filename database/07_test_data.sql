-- ============================================
-- TEST DATA
-- ============================================

-- 1. BRANCHES

-- Existing Tagbilaran branch
INSERT INTO branches (
    branch_code,
    branch_name,
    address,
    phone
)
VALUES (
    'TAG001',
    'Tagbilaran Branch',
    'Tagbilaran City, Bohol',
    '09000000000'
)
ON CONFLICT (branch_code) DO NOTHING;


-- Second test branch
INSERT INTO branches (
    branch_code,
    branch_name,
    address,
    phone
)
VALUES (
    'PAN001',
    'Panglao Branch',
    'Panglao, Bohol',
    '09111111111'
)
ON CONFLICT (branch_code) DO NOTHING;

-- 2. SUPPLIERS

INSERT INTO suppliers (
    company_name,
    contact_person,
    email,
    phone,
    address
)
VALUES (
    'Bohol Auto Parts Supply',
    'Juan Dela Cruz',
    'supplier@example.com',
    '09222222222',
    'Tagbilaran City, Bohol'
);

-- 3. PARTS MASTER

INSERT INTO parts_master (
    supplier_id,
    part_number,
    part_name,
    description,
    category,
    unit_of_measure,
    wholesale_cost,
    retail_price
)
VALUES
(
    1,
    'OIL-5W30-001',
    'Engine Oil 5W-30',
    'Fully synthetic engine oil',
    'Lubricants',
    'bottle',
    350.00,
    450.00
),
(
    1,
    'FLT-OIL-001',
    'Oil Filter',
    'Standard engine oil filter',
    'Filters',
    'piece',
    180.00,
    250.00
),
(
    1,
    'FLT-AIR-001',
    'Air Filter',
    'Replacement engine air filter',
    'Filters',
    'piece',
    250.00,
    350.00
),
(
    1,
    'BRK-PAD-001',
    'Brake Pad Set',
    'Front brake pad set',
    'Brakes',
    'set',
    1200.00,
    1600.00
);

-- 4. INVENTORY

INSERT INTO inventory (
    branch_id,
    part_id,
    quantity_on_hand,
    quantity_reserved,
    reorder_level,
    shelf_bin_location
)
VALUES
(
    1,
    1,
    50,
    0,
    10,
    'A-01'
),
(
    1,
    2,
    30,
    0,
    5,
    'A-02'
),
(
    1,
    3,
    20,
    0,
    5,
    'A-03'
),
(
    1,
    4,
    10,
    0,
    3,
    'B-01'
),
(
    3,
    1,
    15,
    0,
    5,
    'A-01'
),
(
    3,
    2,
    8,
    0,
    3,
    'A-02'
),
(
    3,
    3,
    12,
    0,
    4,
    'A-03'
),
(
    3,
    4,
    5,
    0,
    2,
    'B-01'
);

-- 5. USERS

INSERT INTO users (
    branch_id,
    first_name,
    last_name,
    email,
    password_hash,
    role
)
VALUES
(
    1,
    'Michael',
    'Melicor',
    'technician.tagbilaran@example.com',
    crypt('Test123!', gen_salt('bf')),
    'technician'
),
(
    1,
    'Juan',
    'Dela Cruz',
    'manager.tagbilaran@example.com',
    crypt('Test123!', gen_salt('bf')),
    'branch_manager'
),
(
    3,
    'Maria',
    'Santos',
    'manager.panglao@example.com',
    crypt('Test123!', gen_salt('bf')),
    'branch_manager'
),
(
    NULL,
    'Admin',
    'System',
    'admin@example.com',
    crypt('Test123!', gen_salt('bf')),
    'head_office_admin'
);

-- 6. WORK ORDERS

INSERT INTO work_orders (
    work_order_number,
    branch_id,
    assigned_technician_id,
    customer_name,
    customer_phone,
    vehicle_vin_or_plate,
    vehicle_model,
    status,
    labor_fee,
    total_amount
)
VALUES
(
    'WO-TAG-0001',
    1,
    1,
    'Pedro Reyes',
    '09333333333',
    'ABC-1234',
    'Toyota Vios 2020',
    'in_progress',
    500.00,
    1400.00
),
(
    'WO-PAN-0001',
    3,
    NULL,
    'Ana Garcia',
    '09444444444',
    'XYZ-5678',
    'Honda City 2021',
    'open',
    400.00,
    0.00
);

-- 7. WORK ORDER ITEMS

INSERT INTO work_order_items (
    work_order_id,
    part_id,
    quantity_used,
    unit_price_charged,
    subtotal
)
VALUES
(
    1,
    1,
    2,
    450.00,
    900.00
),
(
    1,
    2,
    1,
    250.00,
    250.00
),
(
    2,
    1,
    1,
    450.00,
    450.00
);

-- 8. TRANSFER REQUESTS

INSERT INTO transfer_requests (
    transfer_code,
    source_branch_id,
    destination_branch_id,
    requested_by_user_id,
    approved_by_user_id,
    status,
    request_notes
)
VALUES
(
    'TR-TAG-PAN-0001',
    1,
    3,
    3,
    2,
    'approved',
    'Panglao Branch requests additional engine oil stock.'
);

-- 9. TRANSFER ITEMS

INSERT INTO transfer_items (
    transfer_id,
    part_id,
    quantity_requested,
    quantity_approved,
    quantity_received
)
VALUES
(
    1,
    1,
    5,
    5,
    0
);

-- 10. Audit Logs

INSERT INTO audit_logs (
    table_name,
    operation,
    record_id,
    branch_id,
    performed_by_user_id,
    old_data
)
VALUES
(
    'transfer_requests',
    'INSERT',
    1,
    3,
    3,
    NULL
);

-- 11. INVENTORY FUNCTION TESTS

SELECT deduct_inventory(1, 1, 5);

SELECT add_inventory(1, 1, 5);

-- 12. TRANSFER INVENTORY FUNCTION TEST

SELECT transfer_inventory(1, 3, 1, 5);