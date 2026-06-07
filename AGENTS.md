# AGENTS

## Commands

- `npm install --cache .npm-cache`
- `npm start`
- `npm run build`
- `npm test`
- `npm run test:e2e`
- `npm run verify`

## Repository Rules

- Follow the ordered checklist in `docs/2026-06-03 - V1 Impl.md`.
- Work one checklist item at a time.
- After each item, verify it, note the result, and move on.
- Use `npm test` for unit coverage and `npm run test:e2e` for Electron flows.
- For restart or persistence e2e, reuse the same `userDataDir` between launches; a fresh profile is not a restart.
- Prefer `tests/e2e/electronHarness.ts` for Playwright/Electron validation.
- If a change needs visual inspection in the app, stop and ask the user rather than guessing.
- Keep Electron pinned to `42.3.2` until a deliberate upgrade decision is made.
- Keep the renderer behind a narrow preload API. Do not add generic IPC send helpers.
- Prefer small, incremental changes that can be validated immediately.

## Boundaries

- `src/main.ts` owns the Electron app lifecycle and main-process IPC handlers.
- `src/preload.ts` owns the typed bridge into the renderer.
- `src/renderer.tsx` and related React components own the UI.
- Local persistence will live behind main-process boundaries when it is added.
