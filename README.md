# IndicoInk

IndicoInk is a Windows Electron app for conference slide notes.

## Install

```powershell
npm install --cache .npm-cache
```

## Start

```powershell
npm start
```

An installed or packaged executable can open an Indico event directly from the
command line. The URL may be supplied as a positional argument or with
`--indico-url`:

```powershell
IndicoInk.exe https://indico.cern.ch/event/1234
IndicoInk.exe --indico-url https://indico.cern.ch/event/1234
```

If IndicoInk is already running, the existing window is focused and opens the
requested event.

## Open Packaged

```powershell
npm run package
npm run open:packaged
```

## Build

```powershell
npm run build
```

## Windows Installer

```powershell
npm run make
```

The make command regenerates the branded Squirrel loading panel before
building the installer. Release CI runs the same command for both x64 and
arm64 installers.

## Test

```powershell
npm test
npm run test:e2e
```

## Verify

```powershell
npm run verify
```

## Notes

- Electron is pinned to `42.3.2` for the initial V1 baseline.
- The local Electron cache is redirected into the workspace by the npm scripts.
- The V1 implementation plan lives in `docs/2026-06-03 - V1 Impl.md`.
