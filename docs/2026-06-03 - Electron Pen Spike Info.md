# Indico Pen Spike Architecture

## Purpose

This repository is a throwaway Electron spike to answer one narrow question:

Can Electron/Chromium on the target Windows pen device provide acceptable stylus behavior over a rendered PDF?

The spike is deliberately small. It is not the Indico app, and it does not include storage, sync, auth, export, or agenda features.

## High-level Flow

1. Electron starts the app and creates the main window.
2. The renderer shows a single toolbar plus a continuously scrolling PDF surface.
3. The user opens a local PDF through the native file picker.
4. The main process reads the file from disk and returns the bytes to the renderer.
5. The renderer passes those bytes to PDF.js and renders pages into canvas elements.
6. Each rendered page has a transparent SVG overlay for pen and eraser input.
7. Strokes live in React state and are undoable / redoable for the current session only.
8. Pointer diagnostics in the toolbar expose raw pointer fields and resolved tool state for on-device testing.

## Runtime Layers

### Main process

File: `src/main/index.ts`

Responsibilities:

- create the Electron window
- expose IPC handlers for opening a PDF and reading a file
- load the built renderer in dev and production

It does not own document state or stroke state.

### Preload

File: `src/preload/index.ts`

Responsibilities:

- expose a minimal safe API on `window.electronApi`
- bridge renderer calls to main-process IPC

The renderer should only talk to Electron through this API.

### Renderer

Files:

- `src/renderer/src/App.tsx`
- `src/renderer/src/inkInteraction.ts`
- `src/renderer/src/strokeState.ts`
- `src/renderer/src/styles.css`

Responsibilities:

- show the toolbar
- open PDFs
- render pages with PDF.js
- capture mouse, pen, eraser, and touch pointer input
- resolve pointer events into a centralized mouse / pen / eraser tool state
- manage undo / redo state
- draw black strokes in an SVG overlay
- erase whole strokes by hit testing
- let touch drag scroll the document rather than draw

The renderer is the only place that knows about the visible PDF view and ink overlay.

## PDF Rendering Model

- A PDF document is loaded into PDF.js from bytes.
- Pages are rendered continuously in a vertical stack.
- Each page gets its own canvas.
- Page geometry is derived from the PDF page viewport.
- The ink overlay is sized to match the page viewport so stroke coordinates can stay normalized.

Current implementation note:

- Page status is shown in the page frame while loading / rendering / erroring.
- Rendering is intentionally kept session-only and does not persist to disk.
- PDF.js compatibility shims are loaded for the renderer and worker paths before PDF.js rendering.
- Pages render with PDF.js `intent: 'print'`, which was part of the validated rendering path in this Electron runtime.

## Ink Model

Stroke data is defined in `src/renderer/src/strokeState.ts`. Pointer tool
resolution and stroke-width helpers are defined in `src/renderer/src/inkInteraction.ts`.

Stroke shape:

- `id`
- `pageNumber`
- `points[]`
- `width`

Point shape:

- normalized `x`
- normalized `y`
- `pressure`
- event `time`

Behavior:

- pen mode creates strokes from pointer events
- pen pressure adjusts stroke thickness as points are rendered, scaling up to 50% above the base width
- mouse input is kept as a drawable test path and uses the mouse/crosshair tool state
- touch input is handled before drawable-pointer checks and scrolls the active document container
- the hardware pen eraser is auto-detected from pointer button state while active/contacting and removes whole strokes
- the current pointer tool drives the toolbar badge and SVG cursor class
- on the tested Windows tablet, eraser hover still reports as pen hover; eraser contact resolves correctly, but the native stylus cursor may remain the pen dot even when the SVG layer has the eraser class
- undo / redo is implemented as a reducer history stack

## Pointer Diagnostics

The toolbar diagnostics are intentionally verbose while this remains a hardware
spike. They show raw pointer fields (`pointerType`, `button`, `buttons`,
`pressure`, and `isPrimary`), the resolved pointer tool, any latched active tool,
the rendered tool state, the SVG layer class, and a summarized computed cursor.

Use these diagnostics to separate three failure modes:

- the device does not expose the expected pointer fields
- the renderer resolves or latches the wrong tool
- the app state and CSS are correct, but the OS/Electron stylus cursor does not visibly repaint

## Build and Launch

Files:

- `scripts/build.mjs`
- `scripts/dev.mjs`
- `scripts/postinstall.mjs`

Build flow:

- compile main and preload TypeScript into `out/`
- build the renderer with Vite
- rewrite the built renderer HTML so Electron file loading works reliably
- `npm install` runs `scripts/postinstall.mjs`, which verifies/repairs the Electron binary and then runs the build

Dev flow:

- verify Electron and built app artifacts exist
- launch Electron against the built app with an isolated user-data directory and GPU-disabling flags

This keeps `npm run dev` launch-only after install. It avoids the earlier flaky
launcher path that produced the `Electron uninstall` failure and makes missing
install/build prerequisites fail immediately with readable errors.

## What Is Intentionally Not Here

Not included in this spike:

- Indico data model
- SQLite
- authentication
- agenda browsing
- markdown export
- cloud sync
- durable persistence

Those belong to the real app only after the pen-on-PDF experience feels acceptable on the target device.

## Current Debug Focus

The app has been tightened to make render and pointer state more visible because
the current work is about diagnosing PDF rendering and pen behavior on the actual
device.

If the PDF area goes blank or gray again, the first things to inspect are:

- whether a page status chip appears
- whether the page canvas is sizing correctly
- whether PDF.js is completing the page render
- whether the built renderer HTML is still using the correct relative asset paths

If pen or eraser behavior looks wrong, inspect the toolbar diagnostics before
changing input code. In particular, confirm the raw `button` / `buttons` values,
resolved pointer tool, active latched tool, rendered SVG class, and computed
cursor. See `FUTURE.md` for the latest notes on Windows tablet eraser hover and
native cursor limitations.

## Future Notes

### Keep Electron on a Supported Major

The spike currently uses Electron 39. Electron moves quickly because it tracks
Chromium, and Electron only officially supports the latest three stable major
versions. As of May 28, 2026, Electron 39 is already past its May 5, 2026
end-of-life date.

For future work, prefer upgrading to a currently supported Electron major before
doing deeper PDF or pen-input debugging. At the time this note was written,
Electron 42 was the newest stable major. After upgrading, verify the narrow app
surface:

- `npm run build`
- open `2026-04-29 - Vibe Plotting.pdf`
- confirm pages render visibly
- confirm pen/mouse drawing still works
- confirm eraser, undo, and redo still work

The PDF rendering issue fixed in this spike was partly caused by `pdfjs-dist`
expecting newer JavaScript runtime APIs than Electron 39 provided. Staying on a
supported Electron major should reduce that kind of compatibility friction, but
dependency bumps still need testing because PDF.js and Electron/Chromium can move
at different speeds.

### Treat Mouse, Pen Tip, and Eraser as Pointer Tools

On the Windows 11 tablet, the useful distinction is not three different pointer
types. The trackpad reports as `pointerType === "mouse"` and CSS cursor changes
work normally there. Both the pen tip and the hardware eraser report as
`pointerType === "pen"` when hovering. The eraser only becomes distinguishable
while it is active/contacting the surface, via the pen eraser button state
(`button === 5` or `buttons & 32`).

That means future input handling should keep one centralized "pointer tool"
decision:

- `mouse`: trackpad/mouse pointer, currently shown as the crosshair.
- `pen`: normal stylus tip, currently shown as the dot.
- `eraser`: stylus eraser contact, currently used to erase strokes.

Do not assume eraser hover can be detected from web pointer events on this
tablet. If a future Electron/Chromium version exposes better hover identity, it
should be treated as an enhancement and verified on-device.

The current tablet result is important: during eraser contact, the renderer can
resolve `eraser`, latch it as the active tool, render the SVG layer with
`ink-layer eraser`, and still the visible Windows stylus cursor may remain the
pen dot. That suggests CSS cursor rendering for active stylus input is not a
reliable UI signal in this environment, even when it works for trackpad/mouse.

If the visible eraser shape matters in future work, prefer drawing an in-page
tool marker instead of relying on the OS/CSS cursor for stylus input:

- keep CSS cursor behavior for mouse/trackpad
- hide or ignore the native cursor for pen input where possible
- render a small DOM/SVG overlay marker at the latest pointer coordinates
- use the centralized pointer-tool state to draw a dot for pen and a square or
  eraser marker for eraser contact
- keep touch handling separate so finger drag continues to scroll rather than
  draw or erase

Useful debug output when revisiting this:

- raw `pointerType`, `button`, `buttons`, `pressure`, and `isPrimary`
- resolved pointer tool and any latched active tool
- rendered SVG class such as `ink-layer pen` or `ink-layer eraser`
- computed CSS cursor
- optionally Electron `webContents` `cursor-changed` events from the main process
