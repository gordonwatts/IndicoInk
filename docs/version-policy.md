# Version Policy

- Electron is initially pinned to `42.3.2`.
- Keep `package.json` and `package-lock.json` in sync with that pin.
- Upgrade Electron only after the app still passes install, startup, packaging, and smoke checks on Windows.
- Prefer the smallest supported upgrade step that fixes a specific issue or unlocks a validated dependency update.
