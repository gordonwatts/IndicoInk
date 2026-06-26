# Architecture

## Current Shape

- `src/main.ts` creates the Electron window, registers the current app-info IPC handler, and owns lifecycle events.
- `src/preload.ts` exposes a single typed `window.indicoInk.getAppInfo()` bridge.
- `src/renderer.tsx` mounts the React app.
- `src/App.tsx` contains the current shell UI.

## Responsibilities

- Main process:
  - Owns app startup and window creation.
  - Owns privileged IPC handlers.
  - Owns any future filesystem or database access.
- Preload:
  - Exposes a narrow typed API to the renderer.
  - Does not expose generic IPC send or invoke helpers.
- Renderer:
  - Owns the visible UI and user interaction.
  - Will own the PDF view and ink overlay when those features land.

## Current Data Flow

1. The renderer requests app info through `window.indicoInk.getAppInfo()`.
2. The preload forwards that request through a dedicated IPC channel.
3. The main process returns the app name, app version, and Electron version.

## Notes

- The app is using Electron Forge with Vite, TypeScript, React, and npm.
- The persistence spike validated a packaged Electron build that reads, writes, transactions, and restarts through the main process only, with local data stored under the app's `userData` directory and a narrow preload bridge for save/load calls.
- The local-data implementation uses a versioned SQLite-compatible store behind the main process; the renderer does not talk to the database directly.
- Any future local-data layout should be documented only after the implementation is validated.
- Dev launches now support an isolated `userData` directory via `INDICOINK_ISOLATED_USER_DATA=1`, while GPU-disabled startup remains opt-in via `INDICOINK_DISABLE_GPU=1`.
- The PDF preview diagnostics now expose worker source, renderer URL, base URI, page status, page sizing, and render-completion counts so blank or gray-page failures can be separated from pointer and ink issues.
- On the target Windows pen device, mouse uses the crosshair cursor path, pen tip resolves to the in-page pen marker, and hardware eraser contact resolves to the in-page eraser marker even when the native stylus cursor does not visibly change.
- Pen pressure is reflected in the rendered stroke-width path and the pressure meter, and section 3 is accepted after the target-device pen, eraser, touch, mouse, and cursor checks passed.
- V1 final target-device manual checklist was run on June 26, 2026 against Electron `42.3.2` with the Slide Notes fixture deck open. Mouse drawing used the crosshair cursor path and enabled undo/redo. Pen-tip input reported `pointerType: "pen"`, `buttons: 1`, pressure from `0` up to about `0.73`, `ink-layer pen`, and the in-page pen marker. Hardware eraser contact reported `button: 5` / `buttons: 32`, `ink-layer eraser`, and the in-page eraser marker. Pen hover reported `buttons: 0` / `pressure: 0` and resolved to the pen marker; eraser hover remains a known platform limitation because reliable eraser identity is only available during contact on this device. Finger touch reported `pointerType: "touch"`, resolved to `ink-layer touch`, showed no marker, and scrolled the app surface from about `767px` to `1913px` without drawing.
- Agenda canvas validation notes from real conference data:
  - Column widths that keep the interface readable in practice landed in the roughly `300-420px` range for session columns, with wider single-column days allowed to expand further.
  - Talk titles longer than about one line at those widths need room to wrap cleanly; the renderer now sizes cards from the solved column width instead of assuming a fixed width.
  - Single-PDF rows should stay explicit in the agenda scan; the `PDF` chip remains visible alongside the annotated-slide count so the user can tell the difference quickly.
  - Shared agenda items such as plenaries, opening sessions, and lunch-style blocks need a full-width treatment and a stronger orientation cue than ordinary parallel-session columns.
