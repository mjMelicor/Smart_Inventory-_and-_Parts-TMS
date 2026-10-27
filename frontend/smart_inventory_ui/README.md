# Smart Inventory and Parts Transfer Management System

React/Vite frontend for the multi-branch automotive repair inventory system.

## Included roles
- Technician
- Branch Manager
- Head Office Admin

## Included requirements
### Technician
- API-backed login and role-based access
- Sign-up with home branch
- Dashboard
- Repair jobs
- Repair job details and billing
- Parts search across all branches
- Stock and bin visibility
- Record parts used through the API with transactional inventory deduction
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
- Date- and branch-filtered sales reports
- Stock audit/history
- System settings

## Technology scope
This frontend connects to the Express API. Inventory and transfer rules are validated by the backend and PostgreSQL, not simulated in browser state. See `../../backend/README.md` for database and API setup.

## Run
1. Install Node.js 20.19 or later.
2. Configure and start the API as described in `../../backend/README.md`.
3. Copy `.env.example` to `.env` in this folder and set `VITE_API_URL` if the API is not at the local default.
4. In a terminal in this folder, install the locked dependencies and start the development server:

```bash
npm ci
npm run dev
```

5. Open the local Vite URL shown in the terminal.

Sign in with an account registered in the connected database. There are no demo credentials. The first Head Office admin is created by the backend seed command; manager and additional admin signups require one-time setup codes issued by an administrator.

Pending receipt, work-order, and parts-usage attempts are kept in browser `localStorage` so a retry after a page reload can reuse the original idempotency key and request details. Do not clear the pending attempt until you have confirmed its result. Because the saved details can include customer or vehicle information and browser storage is readable by page scripts, use a trusted, access-controlled device and protect the app against cross-site scripting.

For deployment, run `npm ci` followed by `npm run build` and publish the generated `dist` folder using the selected static hosting service. Set `VITE_API_URL` at build time to the HTTPS backend URL.
