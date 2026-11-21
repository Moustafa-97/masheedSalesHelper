# masheedSalesHelper

Sales tracking for reps: clients and credit limits, products, orders, collections and cheques, quotations, lost deals, and a client portal.

- `apps/api`: NestJS 12 + TypeORM + PostgreSQL (port 4000)
- `apps/web`: Next.js 16 + Tailwind, Arabic (RTL) and English (port 3000). The browser only talks to the web app; `/api/*` is forwarded to the API.

## Status

**Phase 1 (done):** sign-in by email or mobile, roles (admin / rep / client), users, clients with credit terms (reps see only their own clients; credit terms are admin-only), product catalogue (product + brand + size, unit, minimum quantity), Arabic/English.

Next: orders (credit check, WhatsApp message, PO, documents) → collections, cheques, guarantees and email alerts → quotations with PDF export → lost deals and market prices → client portal → admin dashboard and deployment.

## Run it on Windows

Requirements: **Node.js 22 or newer** and a **PostgreSQL 16** database. Either:
- install PostgreSQL for Windows (https://www.postgresql.org/download/windows/) and create a database, or
- create a free database on Neon (https://neon.tech) and copy its connection string (then set `DATABASE_SSL=true`).

```powershell
git clone https://github.com/Moustafa-97/masheedSalesHelper.git
cd masheedSalesHelper
npm run install:all

# API settings
copy apps\api\.env.example apps\api\.env
# edit apps\api\.env: DATABASE_URL, JWT_SECRET (32+ characters), ADMIN_EMAIL, ADMIN_PASSWORD

# web settings
copy apps\web\.env.example apps\web\.env.local

# create the tables and your admin account (add :demo for sample clients and products)
npm run seed:demo

# in two terminals
npm run dev:api
npm run dev:web
```

Open http://localhost:3000 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Tests

`npm run test:api` runs the API end-to-end tests against a separate database (`DATABASE_URL` for tests defaults to `postgres://sales:sales@localhost:5432/sales_test`; its schema is reset on every run).

## Database changes

Edit the entities, then `npm --prefix apps/api run migration:generate -- src/migrations/<Name>`, and add the new class to `apps/api/src/migrations/index.ts`. Migrations run automatically when the API starts.
