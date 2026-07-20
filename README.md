test password
priya@test.com
123456

# Splitwise App

This repository contains a Splitwise-like app with:

- **Backend** (Node.js + Supabase)
  - Auth + API routes
  - CSV importer with anomaly detection (the “BIG ONE”)
  - Balance computation + settlements (“who owes whom”)

- **Frontend** (React)
  - Login
  - Dashboard
  - Expense tables / group cards
  - Import modal

## Quickstart (local)

### 1) Backend

```bash
cd backend
npm install
npm run dev
```

> Note: This demo works without Supabase because auth is a local JWT.

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```


## Docs

- `docs/SCOPE.md`
- `docs/DECISIONS.md`
- `docs/AI_USAGE.md`
- `docs/IMPORT_REPORT.md`

