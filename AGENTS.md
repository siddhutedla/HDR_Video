# Repository Guidelines

## Project Structure & Module Organization
- `index.html`: single entry point wiring `styles/main.css` and `scripts/app.js`, defines the dropzone and status chips.
- `scripts/app.js`: handles HDR capability detection, drag/drop + file picker, Radiance HDR parsing, ACES-like tone mapping, and canvas rendering; legacy `<video>` elements remain for potential future playback.
- `styles/main.css`: theme variables, glassy cards, responsive grid, and component styles; favor reusing existing CSS custom properties.
- `assets/HDR_041_Path_Ref.hdr`: bundled sample; keep the filename unchanged so default loading continues to work.

## Build, Test, and Development Commands
- `python -m http.server 8000` (from repo root) — serve the static files locally to avoid fetch/CORS issues; open `http://localhost:8000`.
- `npx http-server . -p 8000` — alternative static server if Node is installed; no build step required.
- Use any live-reload dev server if desired, but keep the served root at the repository base so relative asset paths resolve.

## Coding Style & Naming Conventions
- HTML/CSS/JS use 2-space indentation; keep JS strings single-quoted with trailing semicolons (matches `scripts/app.js`).
- Prefer `const`/`let`, arrow functions, early returns for validation (e.g., reject non-`HDR_041_Path_Ref.hdr` quickly).
- Keep functions cohesive and side-effect scoped (UI updates grouped with their actions).
- CSS: continue using the defined custom properties (`--bg`, `--accent`, etc.) and utility class patterns; avoid inline styles except where dynamic status colors are set in JS.
- File and class names: lower-kebab for CSS classes, short lowercase filenames (`app.js`, `main.css`).

## Testing Guidelines
- Manual sanity pass after changes:
  1. Start a local server (above).
  2. Verify capability chips populate (HDR/gamut text).
  3. Drop `HDR_041_Path_Ref.hdr` and confirm canvas renders and metadata shows dimensions + MB.
  4. Drop a wrong filename to confirm the rejection path displays an error and hides the video shell.
  5. Check console for render timing messages; no uncaught errors.
- No automated tests exist yet; if adding logic, keep pure helpers isolated to simplify future unit tests.

## Commit & Pull Request Guidelines
- Commit messages: concise, present-tense imperatives (e.g., “Add client-only HDR viewer”); keep body optional unless rationale is non-obvious.
- Pull requests: small, focused changes; include summary, manual test steps, and screenshots/GIFs for UI tweaks; link issues when applicable and note any new dependencies or assets.

## Branching & Release Flow
- Work on `dev` first; push all feature and fix branches via `dev` (or open PRs into `dev`) so CI runs before promotion.
- `main` is release-ready; only fast-forward or merge from tested `dev` (ideally via PR) after green CI.
- For significant or user-facing changes, open a PR (dev → main) even if you have direct push rights.

## Security & Configuration Tips
- The app is client-only; avoid adding upload endpoints or third-party telemetry.
- Preserve strict file validation (currently accepts only the bundled HDR sample); if supporting more files, keep explicit allowlists and clear user messaging.
- Favor zero-build, static hosting; add tooling only when necessary and document any new setup commands.
