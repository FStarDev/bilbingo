# Bilbingo

Frontend uses TypeScript + Vite. The repo now also includes a small Node.js backend with Express + SQLite for sales storage and statistics.

## Run locally

1. Install Node.js 20+.
2. Install dependencies:
   npm install
3. Start frontend dev server:
   npm run dev
4. Start backend API in a second terminal:
   npm run dev:backend

Backend default URL:

http://localhost:8787

## Build static files

1. Build:
   npm run build
2. Output folder:
   dist

Backend build output:

backend/dist

## Backend API

Database file is created automatically at:

backend/data/bilbingo.sqlite

Available endpoints:

- GET /api/health
- GET /api/period/current
- POST /api/sales
- GET /api/stats/cashier/current?cashierNumber=1
- GET /api/stats/admin?scope=week|season|all&cashierNumber=all|1|2|3
- GET /api/sales-log?scope=week|season|all&cashierNumber=all|1|2|3&limit=100

Example POST /api/sales body:

```json
{
   "salespersonName": "Anna",
   "cashierNumber": 2,
   "items": [
      { "id": "storbingo", "name": "Storbingo", "price": 50, "quantity": 2 },
      { "id": "rovaren", "name": "Rovaren", "price": 20, "quantity": 1 }
   ]
}
```

## Start Backend Only

Run compiled backend:

npm run start:backend

Deploy the dist folder to any static host or static web server.

> Note: opening `dist/index.html` directly from disk may still behave differently across browsers. Firefox is stricter with `file://` and ES module loading, so using a local web server is the safest option.

## Serve static build locally

Option A (with npm package):

npx serve dist

Option B (Python):

python -m http.server 8080 --directory dist

Open http://localhost:8080.
