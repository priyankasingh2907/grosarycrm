# Grocery CRM API

A Node.js/TypeScript REST API for the grocery CRM. Requires Node.js 20+, npm, and PostgreSQL 15+.

## Local setup

Create a PostgreSQL database (for example, `grocery_crm`), then copy the sample configuration and set a private database URL and random JWT secret:

```powershell
Copy-Item .env.example .env
```

Edit `.env`, then run:

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

The API defaults to port `3000`. `GET /health` reports service and database readiness. Application routes are mounted under `/api/v1`.

The development seed creates `admin@grocery.local` with password `ChangeMe123!`. This example credential is public with the source: replace it immediately, never reuse it, and do not expose a seeded environment to the internet.

## Authentication and authorization

Send `{ "email": "...", "password": "..." }` to `POST /api/v1/auth/login`. Authenticated requests send the returned access token using `Authorization: Bearer <accessToken>`.

Protected backend routes check user permissions and assigned-store access. Client navigation is a presentation aid, not an authorization boundary.

## Database

Tracked PostgreSQL migrations live in `migrations/`. The migration runner records completed migrations in `schema_migrations`. SQL statements use parameterized values.

## Integrations

`src/integrations/providers.ts` contains provider interfaces only. Live Razorpay or Stripe payments/refunds, email, WhatsApp, and PDF invoice rendering are not implemented. Each service requires a real adapter, provider account, environment-only credentials, error handling, and appropriate security checks before use. Invoice endpoints return invoice data and do not produce PDF files.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the development server with TypeScript watch mode. |
| `npm run db:migrate` | Apply pending migrations. |
| `npm run db:seed` | Seed local development data. |
| `npm test` | Run the current backend test suite. |
| `npm run build` | Compile TypeScript into `dist/`. |
| `npm start` | Start the compiled API. |
