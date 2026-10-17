# Windows MSIX distribution

IndicoInk uses Electron Forge's `@electron-forge/maker-msix` to create a
package with the stable package identity `IndicoInk`. The generated manifest
declares the Electron desktop `runFullTrust` capability and `internetClient`
for Indico, PDF, and configured model-service requests. It does not request
App Actions capabilities; App Actions remain out of scope for issue #170.

## Build and sign

The Windows 10/11 SDK is required to build MSIX packages. Run `npm run make`
on Windows for the current machine architecture, or pass `-- --arch=x64` or
`-- --arch=arm64`. The generated package is under `out/make/msix/<arch>/`.
`npm run generate:msix-assets` regenerates the manifest's PNG tiles from the
checked-in IndicoInk light icon.

For a local test package, the MSIX maker signs with its generated development
certificate. Trust that certificate only on a disposable/test machine. Do not
publish a package signed with the development certificate.

Release CI requires these repository settings:

- Secret `INDICOINK_MSIX_CERTIFICATE_BASE64`: base64-encoded PFX signing
  certificate.
- Secret `INDICOINK_MSIX_CERTIFICATE_PASSWORD`: PFX password.
- Repository variable `INDICOINK_MSIX_PUBLISHER`: the exact certificate
  subject distinguished name, including `CN=` when present.

The publisher in the manifest must match the PFX subject. CI fails before
packaging if any setting is absent, and verifies each package signature before
publishing the x64 and arm64 `.msix` release assets. The repository owner must
provision the certificate and set the matching publisher variable before a
release can be published. The publisher identity is intentionally supplied
by repository configuration so this code does not claim an unverified legal
or Store identity.

The package version is derived from the GitHub release tag. Windows MSIX
versioning uses a four-part numeric version; the maker normalizes the
repository's semantic version for the manifest.

## Existing Squirrel user data

On the first packaged launch, the main process looks for the previous
per-user profile under `%APPDATA%\IndicoInk` and copies entries that are
present into the new Electron `userData` directory:

- `indicoink-persistence.sqlite3` and SQLite sidecar files
- `indicoink-settings.json`
- `indicoink-credentials.json`
- `deck-cache/`

The migration writes `squirrel-user-data-migrated.json` after the copy. It
never replaces a destination file, so already-created MSIX data takes
precedence. Credential blobs are copied byte-for-byte and rely on Windows
DPAPI/safeStorage remaining usable for the same Windows user. Migration is
logged in `startup.log` when it runs or fails. The old profile is retained;
the migration does not uninstall the Squirrel application.

Unit tests cover copy, existing destination precedence, missing source, and
one-time behavior. A real Squirrel-to-MSIX upgrade has not been accepted yet.
The source `%APPDATA%` path and credentials must be confirmed with the actual
signed package on a clean Windows account; keep the Squirrel install and
source profile intact until that acceptance is recorded.

## Acceptance still required

This repository change makes the package and release pipeline repeatable; it
does not claim the issue's machine-level acceptance criteria are complete.
Before treating MSIX as the validated release path, run on clean x64 and
arm64 Windows accounts with the production signing certificate:

1. Install, launch, update to a newer signed package with the same package
   identity, and uninstall.
2. Upgrade from the current Squirrel build and confirm notes, cached events,
   settings, credentials, and PDF decks remain usable after relaunch.
3. Exercise command-line Indico URL activation and single-instance focus.
4. Open a cached PDF, draw and erase annotations, restart with the same user
   profile, and export notes.
5. Confirm the signature and publisher identity on the intended supported
   Windows versions and both architectures.

Microsoft Store submission still requires Partner Center identity
reservation, Store-specific package validation, and Store signing/submission.
