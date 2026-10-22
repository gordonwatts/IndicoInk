# Version Policy

- Electron is pinned exactly to `45.0.0`, the current stable release as of October 22, 2026.
- Keep `package.json`, `package-lock.json`, and this documented pin in sync.
- Check Electron's supported stable releases before each upgrade; its current support policy covers the latest three stable major versions.
- Upgrade Electron only after the app passes install, startup, packaging, and smoke checks on Windows.
- Keep Electron upgrades as dedicated changes and record relevant breaking changes and regression results.

## Electron and PDF.js Upgrade Regression Checklist

Before accepting any Electron or PDF.js upgrade:

- [x] Reinstall dependencies and confirm the app still installs cleanly on Windows.
- [x] Run `npm run build` and confirm the packaged app is created successfully.
- [ ] Launch the packaged app and confirm a visible PDF page renders in the viewer.
- [ ] Draw with the mouse and confirm the stroke appears on the intended page.
- [ ] Draw with the pen tip and confirm pressure-sensitive strokes still render.
- [ ] Use the hardware eraser and confirm it removes the intended stroke.
- [ ] Use undo and redo and confirm annotation state restores correctly.
- [ ] Scroll a long PDF with touch and confirm it does not draw.
- [ ] Confirm cursor markers still match mouse, pen-tip, eraser-contact, and touch behavior.
- [ ] Run `npm run verify` and the relevant e2e checks after the upgrade.

### Electron 45 review

- Electron 45.0.0 is the latest stable release on October 22, 2026. Electron 42 reached end of support on October 20, 2026.
- Electron 42.3.2 bundles Chromium 148.0.7778.218, Node.js 24.15.0, and V8 14.8. Electron 45.0.0 bundles Chromium 156.0.8078.48, Node.js 24.22.0, and V8 15.6.
- Electron 45 removes Node shims (`events`, `timers`, `url`) and globals (`Buffer`, `setImmediate`, `clearImmediate`) from sandboxed preload scripts. The app preload imports only `contextBridge` and `ipcRenderer` from Electron and uses none of these removed globals.
- Electron 44 no longer supports macOS 12 or 32-bit Windows/Linux; IndicoInk's Windows packaged target is 64-bit.
- Electron 43–45 also include Chromium, Node.js, and V8 updates, security and stability fixes, and performance improvements to startup, ASAR reads, `contextBridge`, and IPC. See the Electron 45 release notes for details.

Only accept an Electron upgrade after every item above passes on Windows and the target-device results are recorded in `ARCHITECTURE.md`.
