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

To expose the frontend to other devices on the LAN during development:

npm run dev:frontend:lan

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

If `dist` exists, the backend also serves the built frontend on the same port.

Recommended local server flow:

1. Build everything:
   npm run build
2. Start one process only:
   npm run start:server
3. Open the app at:
   http://SERVER-IP:8787

Deploy the dist folder to any static host or static web server.

> Note: opening `dist/index.html` directly from disk may still behave differently across browsers. Firefox is stricter with `file://` and ES module loading, so using a local web server is the safest option.

## Serve static build locally

Option A (with npm package):

npx serve dist

Option B (Python):

python -m http.server 8080 --directory dist

Open http://localhost:8080.

## Automatic deploy to local server (Windows)

If this repository is running on a local server machine, you can auto-update it whenever new commits are pushed.

1. On the server machine, clone this repo and set an upstream branch.
2. Run once manually:

   npm run deploy:auto-local

3. Optional restart handling:

   - If backend runs as a Windows service:

     powershell -ExecutionPolicy Bypass -File .\scripts\auto-deploy-local.ps1 -BackendServiceName "bilbingo-backend"

   - If you restart with your own command:

     powershell -ExecutionPolicy Bypass -File .\scripts\auto-deploy-local.ps1 -RestartCommand "pm2 restart bilbingo-backend"

4. In Task Scheduler, create a task that runs every 5 minutes:

   Program/script:

   powershell

   Arguments:

   -ExecutionPolicy Bypass -File C:\Source\bilbingo\scripts\auto-deploy-local.ps1 -BackendServiceName "bilbingo-backend"

How it works:

- fetch + compare local vs upstream commit
- pull fast-forward only when updates exist
- npm install only when dependency files changed (or always if you prefer forcing it)
- npm run build
- optional backend restart

If no new commit exists, the script exits immediately.

## Quick checklist for the server admin

Use this if someone else will set up the local server.

1. Install Git and Node.js 20+ on the server machine.
2. Clone this repo to C:\Source\bilbingo.
3. Open PowerShell in C:\Source\bilbingo.
4. Run npm install.
5. Build the app:
   npm run build
6. Start the server:
   npm run start:server
7. Open Windows PowerShell as Administrator and allow inbound firewall ports:
   netsh advfirewall firewall add rule name="Bilbingo Backend 8787" dir=in action=allow protocol=TCP localport=8787
8. Verify backend health at http://localhost:8787/api/health.
9. Verify another device on the LAN can open http://SERVER-IP:8787.
10. Run npm run deploy:auto-local once.
11. Create a Task Scheduler job that runs every 5 minutes:
   - Program/script: powershell
   - Arguments: -ExecutionPolicy Bypass -File C:\Source\bilbingo\scripts\auto-deploy-local.ps1 -BackendServiceName "bilbingo-backend"
   - Start in: C:\Source\bilbingo
12. Run the task manually once and confirm logs show pull/build/restart.

Done. New commits will deploy automatically to the local server.

## Recommended Windows local server setup

This is the simplest always-on setup:

1. `npm install`
2. `npm run build`
3. `npm run start:server`
4. Open firewall for TCP 8787 as Administrator
5. Create a startup task in Task Scheduler that runs:
   - Program/script: powershell
   - Arguments: -ExecutionPolicy Bypass -File C:\Source\bilbingo\scripts\register-server-startup-task.ps1
   - Start in: C:\Source\bilbingo

With this setup you do not need to start frontend and backend separately after each reboot. One server process handles both.

### Easier startup task commands

Instead of creating the startup task manually, run:

1. `npm run task:register-server-startup`
2. Optional immediate start: `powershell -ExecutionPolicy Bypass -File .\scripts\register-server-startup-task.ps1 -StartNow`

This script creates a task that runs at machine startup under the `SYSTEM` account to avoid password prompts.

### Auto-deploy with server task restart

If you use the one-process server task (`Bilbingo Server`), run deploy with:

`npm run deploy:auto-local:task`

This will pull/build updates and restart the scheduled task so the new version is served.
