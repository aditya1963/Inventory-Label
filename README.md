# Inventory Label Web App

Static web app for mobile/iPad/desktop to:
- OCR `RELEASE` and `PART NUMBER` from an inventory ticket image
- generate an A4 landscape PDF label
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
- OCR and PDF generation run in the browser.

Note: Browser/CDN caching can still cache static assets like JS libraries.
