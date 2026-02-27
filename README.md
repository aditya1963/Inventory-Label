![1772212110799](image/README/1772212110799.png)![1772212115179](image/README/1772212115179.png)# Inventory Label Web App

Static web app for mobile/iPad/desktop to:
- enter or handheld-scan `PART NUMBER` and `JOB NUMBER`
- generate an A4 landscape PDF label
- render labels in a warehouse template style (barcode + part/description/meta rows)
- use a fixed hardcoded bleed margin (not user-editable)
- choose top-half color from 5 preset options
- live preview of final A4 layout before export
- download PDF or open direct print preview
- keep data in-browser only (no backend, no database)

## Files
- `index.html`
- `styles.css`
- `app.js`
- `.gitignore` (configured to publish only web files)

## Legacy files
- Old Python script and generated PDFs are moved to `obsolete/` for local reference only.
- `obsolete/` is ignored by git.

## Run locally
Open `index.html` in a browser, or serve with any static server.

Handheld scanner use:
- Click in `Part Number` or `Job Number` input first, then scan.
- Most USB/Bluetooth scanners behave like keyboard input in these fields.

## Publish on GitHub Pages
1. Create a new GitHub repo.
2. Add these files to the repo root and push to `main`.
3. Go to `Settings -> Pages`.
4. Under `Build and deployment`, choose:
   - `Source`: `Deploy from a branch`
   - `Branch`: `main` and `/ (root)`
5. Save. Your site URL will be shown by GitHub Pages.

## Privacy / Storage
- No app backend.
- No database.
- No user data is intentionally stored by the app.
- Barcode rendering and PDF generation run in the browser.

Note: Browser/CDN caching can still cache static assets like JS libraries.
