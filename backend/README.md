# Smart Inventory API

Express and Prisma API for the multi-branch repair inventory system. It expects PostgreSQL (including Supabase or Neon) and uses the table names in `database/01_create_tables.sql`.

## Setup

1. Install Node.js 20.19 or later.
2. From this directory, install the exact dependency versions in the lockfile:

   ```sh
   npm ci
   ```

3. Copy `.env.example` to `.env`. Set `DATABASE_URL` to the PostgreSQL connection string, set a unique random `JWT_SECRET` of at least 32 characters, and set `FRONTEND_ORIGIN` to the Vite frontend URL.
4. Prepare the database. For an existing SQL-managed database, first confirm its schema and apply only approved scripts: `01_create_tables.sql` through `06_rls_policies.sql` for initial setup, optional `07_test_data.sql` only in a disposable test database, then `08_api_workflows.sql`. Before deploying the receipt-idempotency backend code, manually review and apply `database/09_transfer_receipt_idempotency.sql` once. It creates the receipt event table the API uses. Do not execute setup, seed, or upgrade scripts against the existing Supabase database without an approved change window and backup.

   `database/10_security_hardening.sql` is a proposed, unapplied change based on the current Supabase advisories. Test its function privilege and search-path changes in an isolated environment and obtain separate approval before applying it.
5. Create the first Head Office administrator by setting `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` (at least 12 characters), `INITIAL_ADMIN_FIRST_NAME`, and `INITIAL_ADMIN_LAST_NAME`, then run:

   ```sh
   npm run db:seed
   ```

6. Start the API:

   ```sh
   npm run dev
   ```

For a production process, install with `npm ci` and start the API with `npm start`. Run the API behind an HTTPS reverse proxy or a hosting platform that provides HTTPS; set `NODE_ENV=production` and `FRONTEND_ORIGIN` to the deployed frontend origin.

The health check is `GET http://localhost:4000/api/health`; it returns HTTP 200 while the API can query PostgreSQL, and HTTP 503 if the database is unavailable. It checks connectivity only, not whether every expected table or upgrade exists. A successful health response does not prove the receipt-idempotency schema is installed. Do not expose the database connection string or JWT secret to the browser.

## API

All routes are under `/api`. Login, registration, and the active-branch list are public; all other routes require `Authorization: Bearer <token>`.

| Capability | Routes |
| --- | --- |
| Authentication | `POST /auth/login`, `POST /auth/register`, `GET /auth/me`, `POST /auth/change-password` |
| Branches and searchable parts | `GET /branches` (public active branch list), `GET /parts?q=&category=`, `GET /technicians` |
| Inventory | `GET /inventory?branchId=&lowStock=`, `PATCH /inventory/:branchId/:partId/reorder-level`, `POST /inventory/adjustments` |
| Repair jobs | `GET /work-orders`, `POST /work-orders`, `GET/PATCH /work-orders/:id`, `POST /work-orders/:id/items`, `PATCH /work-orders/:id/status` |
| Transfers | `GET /transfers`, `POST /transfers`, `PATCH /transfers/:id/decision`, `POST /transfers/:id/dispatch`, `POST /transfers/:id/receive` |
| Reporting and audit | `GET /reports/daily-sales`, `GET /reports/low-stock`, `GET /audit-logs` |
| Administration | `GET/POST/PATCH /users`, `POST /setup-codes`, `GET/POST/PATCH /suppliers`, `POST/PATCH /parts`, `GET /branches/admin`, `POST/PATCH /branches` |

Technicians can self-register against an active home branch. Branch-manager and additional administrator accounts require one-time setup codes. An administrator creates these using `POST /setup-codes`; each code expires after 24 hours. Signup alone does not create a session; the user signs in after registration.

Manager operations are restricted to their assigned branch. Technicians can search stock across branches but can only use parts on their assigned work orders and request transfers to their own branch. Transfer requests reserve source stock atomically; rejection releases the reservation, dispatch deducts it, and receipt adds stock to the destination. Inventory-changing actions are written to `audit_logs`.

## Frontend

The Vite UI now uses the API for authentication and its primary operational and administration screens. In `frontend/smart_inventory_ui`, copy `.env.example` to `.env` and set `VITE_API_URL` to the API base URL. For local development, run the API from this directory with `npm run dev`, then run the frontend from its directory with `npm run dev`. Do not put database credentials or the JWT signing secret in the frontend environment.

For production, run `npm ci` and `npm run build` in the frontend directory, then publish the generated `dist` folder through the selected static hosting service. Configure `VITE_API_URL` at build time to the HTTPS API base URL.

The initial Head Office administrator is created with `npm run db:seed` only during a deliberate initial setup; do not run it against an existing production-like database. After signing in, use System Settings to issue one-time setup codes for additional manager/admin registrations. Real database-backed end-to-end checks require an approved, isolated PostgreSQL test database; syntax checks and Prisma schema validation do not verify a live database connection. For an existing Supabase database, do not run `npm run db:push`.

## Deployment notes

Daily Sales uses the IANA time zone configured by `BUSINESS_TIME_ZONE` (default `Asia/Manila`) to define the report day. Set this to the shop's operating time zone in production.

No hosting provider is configured in this repository. Production must set backend-only `DATABASE_URL` and a random `JWT_SECRET` (at least 32 characters), set `NODE_ENV=production`, and allow only the deployed frontend origin through `FRONTEND_ORIGIN`. Set the frontend build-time `VITE_API_URL` to the HTTPS API base URL. Never place database credentials or the JWT secret in frontend variables. Verify the database connection role can read and write the receipt event table after the approved SQL upgrade; the script grants that access to `service_role`, while an owner connection can access its own table. Review database RLS and grants separately before opening the Supabase Data API to clients.

The reviewed API connection currently uses the Supabase `postgres` role, which has `BYPASSRLS`. RLS therefore does not provide row-level protection for API sessions; the Express role and branch checks are currently the effective access controls. Before production, design and test a dedicated application database role with only the required privileges and an RLS strategy compatible with the API. Do not assume that switching to `anon`, `authenticated`, or `service_role` is a safe drop-in replacement; those roles have different grants and RLS behavior.

The existing policies in `database/06_rls_policies.sql` use `auth.jwt()` from Supabase Auth, while this app authenticates with its own Express JWT. Those policies check whether the email is active but do not scope rows to a user's branch. The `users` policy also queries `users` from a policy on that same table, which needs independent verification for recursion behavior. The current Data API roles have no direct grants on the main application tables. Keep it that way until policies and grants are redesigned and tested; do not treat the current policies as branch-level protection.

The frontend keeps its bearer token in `sessionStorage`, which JavaScript can read. Serve only trusted frontend code over HTTPS and review content security and cross-site scripting protections before deployment. Moving tokens to HttpOnly cookies would require a separate CSRF and session design.

Login tokens are tied to a keyed version of the user's current password hash. A password change or administrator reset therefore invalidates that user's existing sessions at the next API request, and the frontend returns the user to sign-in. Deploying this token check invalidates all tokens created by an older backend; users must sign in again after the backend rollout. The raw password hash is never included in a token or API response.

Logout currently clears the token from the current browser only. A copied bearer token remains valid on the server until its configured expiry unless the user's password is changed or the account is deactivated. Immediate per-session revocation would require shared server-side session or token-revocation storage; it is not implemented and should be designed separately before deployment if required by the operating policy.

The hosting provider is still undecided. Do not publish the frontend until the provider, API origin, database access role, and required database upgrades have been reviewed together. Apply `database/09_transfer_receipt_idempotency.sql` only once, after backup and explicit approval; test the separate `database/10_security_hardening.sql` proposal in an isolated environment before considering it for the existing Supabase project.
