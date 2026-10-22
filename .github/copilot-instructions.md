# Workspace Instructions

## Project

Grocery CRM with exactly two application packages: `backend/` is a Node.js TypeScript REST API; `frontend/` is a Flutter app using simple `flutter_bloc` Cubits. PostgreSQL schema and migrations live under `backend/migrations/`.

## Architecture Rules

- Keep business logic inside feature/domain modules and share it through service/repository abstractions; avoid duplicate validation or business rules across routes and UI.
- Enforce role permissions on the backend. Flutter role-based visibility is for navigation and presentation only, never an authorization boundary.
- Keep SQL migrations normalized, additive, and tracked. Use parameterized queries.
- Keep provider credentials in environment configuration. Payment, WhatsApp, PDF, and webhook integrations require explicit provider adapters and signature/security checks; never represent an interface stub as a working integration.
- Follow existing package conventions and keep the backend and Flutter app independently runnable.

## Setup Checklist

- [x] Verify `.github/copilot-instructions.md` exists.
- [x] Clarify requirements: Node.js TypeScript backend, Flutter dashboard with Bloc, PostgreSQL, role-based grocery workflows.
- [x] Scaffold the two packages, SQL schema/migration, login/dashboard foundation, seed roles, and provider interfaces.
- [x] Customize for the requested grocery CRM foundation.
- [x] Install required extensions: none specified.
- [ ] Compile and run tests: blocked in the creation environment because Node.js/npm and Flutter are not installed. Re-run backend `npm install`, `npm test`, `npm run build`; run Flutter `flutter pub get`, `flutter analyze`, and `flutter test` after installing the SDKs.
- [x] Create and run task: not needed for the initial packages.
- [ ] Launch project: not run; requires local runtimes and PostgreSQL.
- [x] Document setup in the root `README.md` and backend `README.md`.

## Current API Scope

Implemented: `GET /health`, `POST /api/v1/auth/login`, and permission-protected `GET /api/v1/dashboard/summary`. The migration includes catalog, inventory, purchase, customer, sales, invoice, payment, and audit tables. These do not yet imply CRUD endpoints or production-ready payment, WhatsApp, or PDF integrations.
