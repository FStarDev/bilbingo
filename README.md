# Thin Client (Browser-Only)

Single-page app using TypeScript + Vite. All calculations run in the browser.

## Run locally

1. Install Node.js 20+.
2. Install dependencies:
   npm install
3. Start dev server:
   npm run dev

## Build static files

1. Build:
   npm run build
2. Output folder:
   dist

Deploy the dist folder to any static host or static web server.

> Note: opening `dist/index.html` directly from disk may still behave differently across browsers. Firefox is stricter with `file://` and ES module loading, so using a local web server is the safest option.

## Serve static build locally

Option A (with npm package):

npx serve dist

Option B (Python):

python -m http.server 8080 --directory dist

Open http://localhost:8080.
