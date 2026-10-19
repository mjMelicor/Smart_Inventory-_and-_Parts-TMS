# Smart Inventory and Parts Transfer Management System

Complete React/Vite UI prototype for the proposed multi-branch automotive repair inventory system.

## Included roles
- Technician
- Branch Manager
- Head Office Admin

## Included requirements
### Technician
- Login and role-based prototype access
- Sign-up with home branch
- Dashboard
- Repair jobs
- Repair job details and billing
- Parts search across all branches
- Stock and bin visibility
- Record parts used with inventory deduction simulation
- Transfer requests
- Transfer status tracking

### Branch Manager
- Dashboard
- Branch inventory
- Low-stock thresholds/settings
- Transfer approval/rejection
- Physical stock validation
- Dispatch workflow
- Receive workflow
- Daily sales report

### Head Office Admin
- Dashboard
- Global inventory
- Branch management
- Users and permissions
- Suppliers
- Parts catalog and pricing
- Transfer history
- Stock audit/history
- System settings

## Prototype behaviors
- Stock deduction is simulated when parts are recorded against a repair job.
- Transfer requests reserve source stock for availability checks.
- Over-booking is blocked when requested quantity exceeds available stock.
- Transfer lifecycle can be demonstrated: Pending Approval -> Approved/Rejected -> Dispatched -> Received.
- Receiving a dispatched transfer adds the received quantity to the destination branch.
- Audit entries are added for usage and transfer events.

## Technology scope
This package is the **frontend/UI prototype only**. It does not yet connect to PostgreSQL/Supabase/Neon, Express, Prisma, real authentication, SQL procedures/triggers, or GitHub. Those are backend/deployment requirements for the implementation phase.

## Run
1. Install Node.js LTS.
2. Extract the ZIP.
3. Open a terminal in this folder.
4. Run:

```bash
npm install
npm run dev
```

5. Open the local Vite URL shown in the terminal.

## Demo
On the login screen, choose a role from the Demo Role selector. The prototype uses mock data and does not require a real account.
