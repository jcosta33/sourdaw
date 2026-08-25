# Desktop Packaging

Desktop packaging is an Electron shell around the browser build and the Rust
native addon. The package layout must leave the renderer in the archive and the
native addon and sample library as real files beside it.

## Current status

- `pnpm desktop:build` is configured for a local macOS arm64 DMG and ZIP.
- `identity: '-'` is ad-hoc signing. It is not distribution signing.
- There is no updater, notarization flow, signing identity, or publish pipeline.
- Windows x64 NSIS configuration exists, but it is not shippable until the native
  addon is built for Windows and included in the package.
- ASIO is not supported. The Windows configuration does not enable it.

## Runtime boundaries

The renderer is packaged in `app.asar`. Native `.node` and linked library files
are unpacked because they must be loaded from the filesystem. Samples are shipped
as resources outside the archive for the same reason.

The macOS entitlement set enables hardened-runtime JIT and third-party native
library loading, and disables the App Sandbox for the current plugin-capable
build. Those settings describe this local package; they are not a claim of
distribution hardening.
