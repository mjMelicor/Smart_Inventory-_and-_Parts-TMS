# Smart Inventory and Parts Transfer Management System

## Project Description

The Smart Inventory and Parts Transfer Management System is a web-based system designed for multi-branch automotive repair shops.

The system provides centralized inventory monitoring, repair job tracking, and branch-to-branch parts transfer management.

It helps automotive repair shops identify available parts across branches, reduce repair delays, prevent duplicate stock purchases, and maintain accurate inventory records.

## Users

### Technician / Service Engineer

- Search for parts across branches
- View available inventory
- Create and manage repair jobs
- Record parts used during repairs
- Request parts from other branches

### Branch Manager

- View branch inventory
- Monitor low-stock items
- Approve or reject transfer requests
- Monitor daily sales
- Manage inventory-related activities

### Head Office Admin

- View inventory across all branches
- Manage users and permissions
- Manage suppliers
- Monitor transfer history
- View system-wide reports and audit logs

## Main Features

- Multi-branch inventory tracking
- Parts search across branches
- Repair job and parts usage tracking
- Branch-to-branch parts transfers
- Low-stock warnings
- Inventory transaction history
- Audit logging
- Role-based access control
- Sales and inventory reports
- Over-booking protection

## Technologies

- React.js
- Node.js
- Express.js
- Prisma ORM
- PostgreSQL
- Supabase or Neon
- Git
- GitHub

## Project Structure

```text
smart-inventory-parts-transfer-system/
│
├── frontend/     # React.js frontend application
├── backend/      # Node.js and Express.js backend
├── database/     # Database scripts and related files
├── docs/         # System documentation and diagrams
├── .gitignore    # Files excluded from Git
└── README.md     # Project documentation
```

## Project Status

The React/Vite frontend now uses the Express/Prisma API for authentication and the main inventory, repair, transfer, reporting, and administration workflows. PostgreSQL is still required: configure the database and environment variables using [`backend/README.md`](./backend/README.md), and configure the frontend API URL using [`frontend/smart_inventory_ui/.env.example`](./frontend/smart_inventory_ui/.env.example). A live database and deployed environment have not been provisioned by this repository.
