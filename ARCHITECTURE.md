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
- The startup and packaging flow still needs more diagnostics before the later PDF and persistence work lands.
- Any future local-data layout should be documented only after the implementation is validated.
- Dev launches now support an isolated `userData` directory via `INDICOINK_ISOLATED_USER_DATA=1`, while GPU-disabled startup remains opt-in via `INDICOINK_DISABLE_GPU=1`.
- The PDF preview diagnostics now expose worker source, renderer URL, base URI, page status, page sizing, and render-completion counts so blank or gray-page failures can be separated from pointer and ink issues.
- On the target Windows pen device, mouse uses the crosshair cursor path, pen tip resolves to the in-page pen marker, and hardware eraser contact resolves to the in-page eraser marker even when the native stylus cursor does not visibly change.
- Pen pressure is reflected in the rendered stroke-width path and the pressure meter, and section 3 is accepted after the target-device pen, eraser, touch, mouse, and cursor checks passed.
