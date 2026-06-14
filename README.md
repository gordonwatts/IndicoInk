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

## Open Packaged

```powershell
npm run package
npm run open:packaged
```

## Build

```powershell
npm run build
```

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
