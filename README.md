# masheedSalesHelper

Sales tracking for reps: clients and credit limits, products, orders, collections and cheques, quotations, lost deals, and a client portal.

- `apps/api`: NestJS 12 + TypeORM + PostgreSQL (port 4000)
- `apps/web`: Next.js 16 + Tailwind, Arabic (RTL) and English (port 3000). The browser only talks to the web app; `/api/*` is forwarded to the API.

## Status

**Phase 1 (done):** sign-in by email or mobile, roles (admin / rep / client), users, clients with credit terms (reps see only their own clients; credit terms are admin-only), product catalogue (product + brand + size, unit, minimum quantity), Arabic/English.

**Product catalogue:** Products → **Import products file** (admin) reads Masheed's ERP export (`Zone, Category, Brand, Product name, Size, Color, Unit`). Names are shortened and grouped across brands (e.g. every brand's *Rebar G60 · 12mm · 12m*), each item keeps its regions and truck loads (`580 Bags`, `600 Pallet`, …), and importing a newer export updates the file's data without touching minimum quantities, active flags or renamed products.

**Phase 2 (orders):** client projects (site name, Google Maps link, contacts); orders with Masheed's SO number, prices excl. VAT and optional purchase prices (margin); a credit check on every order and edit (available = limit − opening balance − orders + payments; cash clients need a payment first); the supply message for WhatsApp without prices; POs, delivery notes, purchase and sales invoices; partial deliveries with a received/ordered counter; automatic *delivered* / *invoiced* status once quantities and documents are complete; nothing is ever deleted (removed lines, deliveries and documents stay visible with a reason) and every change is in the order's history; Excel export of orders, lines, deliveries and a per-project summary. Uploaded files are kept in `apps/api/uploads` (set `UPLOAD_DIR` to change it).

**Credit:** payments by transfer, cash, cheque or LC (a cheque or LC counts as paid once collected; an approved cheque, 100% unless stated, and a payment LC raise the available credit until then); a guarantees section per client (e-promissory notes, LCs, LGs, cheques, credit approved without a guarantee) with coverage of the limit, guarantee cheques / LCs adding approved credit, and bounced guarantee cheques flagged until replaced; statement of account (screen, print, Excel); receivables aging with payments applied oldest first; average collection days; new orders stop when an amount is past due for longer than the client's overdue-stop days (default 30, 0 = off) unless management approval is recorded; dashboard with receivables, overdue and near-limit clients, and cheques and guarantees to follow up.

**Phase 3 (quotations):** quotations saved per client and numbered by the client's code (`B2B-722-00001`, `NEW-00001` for a client without one); a new client can be added from the quotation and is kept under "new clients"; each line has the name the client reads ("Rajhi 12-32") linked to one or more catalogue items; draft → sent → accepted / lost (with reason and competitor price); accepted prices become the client's latest accepted prices and prefill the next order; PDF export laid out like Masheed's template, named "Quotation <date>" unless renamed (browser print → Save as PDF).

Next: lost deals and market prices → email alerts → client portal → admin dashboard and deployment.

## Run it on Windows

Requirements: **Node.js 22 or newer** and a **PostgreSQL 16** database. Either:
- install PostgreSQL for Windows (https://www.postgresql.org/download/windows/) and create a database, or
- use a free Neon database (https://neon.tech): see **Neon** below.

```powershell
git clone https://github.com/Moustafa-97/masheedSalesHelper.git
cd masheedSalesHelper
npm run install:all

# API settings
copy apps\api\.env.example apps\api\.env
# edit apps\api\.env: DATABASE_URL, JWT_SECRET (32+ characters), ADMIN_EMAIL, ADMIN_PASSWORD

# web settings
copy apps\web\.env.example apps\web\.env.local

# create the tables and your admin account (add :demo for sample clients)
npm run seed:demo

# in two terminals
npm run dev:api
npm run dev:web
```

Open http://localhost:3000 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Neon

Run the Neon CLI inside `apps\api` (that is where the API reads its `.env`):

```powershell
cd apps\api
npx neon@latest init -y --org-id <org-id> --project-id <project-id> --branch production --services postgres
npx neon@latest deploy
```

`deploy` writes `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) into `apps\api\.env`. You can instead copy both connection strings from the Neon console (Connect → "Connection pooling" on, then off). The API uses the pooled URL; migrations and `npm run seed` use the direct one. Neon URLs carry `sslmode=require`, so leave `DATABASE_SSL=false`.

The database holds only text and numbers. Uploaded files (POs, delivery notes, cheque images) will go to file storage, not into Postgres.

## Tests

`npm run test:api` runs the API end-to-end tests against a separate database (`DATABASE_URL` for tests defaults to `postgres://sales:sales@localhost:5432/sales_test`; its schema is reset on every run).

## Database changes

Edit the entities, then `npm --prefix apps/api run migration:generate -- src/migrations/<Name>`, and add the new class to `apps/api/src/migrations/index.ts`. Migrations run automatically when the API starts.
