# Version Policy

- Electron is initially pinned to `42.3.2`.
- Keep `package.json` and `package-lock.json` in sync with that pin.
- Upgrade Electron only after the app still passes install, startup, packaging, and smoke checks on Windows.
- Prefer the smallest supported upgrade step that fixes a specific issue or unlocks a validated dependency update.

## Electron and PDF.js Upgrade Regression Checklist

Before accepting any Electron or PDF.js upgrade:

- [ ] Reinstall dependencies and confirm the app still installs cleanly on Windows.
- [ ] Run `npm run build` and confirm the packaged app is created successfully.
- [ ] Launch the packaged app and confirm a visible PDF page renders in the viewer.
- [ ] Draw with the mouse and confirm the stroke appears on the intended page.
- [ ] Draw with the pen tip and confirm pressure-sensitive strokes still render.
- [ ] Use the hardware eraser and confirm it removes the intended stroke.
- [ ] Use undo and redo and confirm annotation state restores correctly.
- [ ] Scroll a long PDF with touch and confirm it does not draw.
- [ ] Confirm cursor markers still match mouse, pen-tip, eraser-contact, and touch behavior.
- [ ] Run `npm run verify` and the relevant e2e checks after the upgrade.

Only proceed with the upgrade if every item above passes on Windows.
