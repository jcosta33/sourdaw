# Desktop Packaging

Desktop packaging is an Electron shell around the browser build and the Rust
native addon. The package layout must leave the renderer in the archive and the
native addon and sample library as real files beside it.

## Native artifact production

`scripts/buildNativeAddon.ts` queries the selected PATH Cargo with `cargo -Vv`
from the repository root and requires one reported host target. That Cargo host,
rather than Node's architecture or a physical CPU inference, selects the native
Darwin, Linux or Windows artifact names. Unsupported or malformed hosts fail
before compilation. This producer builds for Cargo's reported host only;
cross-compilation is outside its contract.

Both Cargo builds explicitly pass that concrete host through `--target` and an
absolute output root through `--target-dir`. The root is `CARGO_TARGET_DIR`,
resolved against the repository root when relative, or `<repo>/target` when unset.
Empty or invalid roots are refused. The addon is read only from
`<root>/<host>/release/<cdylib>`; the scanner is read only from
`<root>/scan-helper/<host>/release/<helper>`. They are staged beside the native
crate as `sourdaw-native.node` and `sourdaw-plugin-scan-helper[.exe]`, preserving
the helper's mode. Only the helper build overrides `CARGO_PROFILE_RELEASE_LTO=false`.

An explicitly set `CARGO_BUILD_TARGET` must equal the reported host or Cargo's
`host-tuple` spelling; empty, custom and conflicting targets are refused before
either build. Cargo configuration defaults such as `build.target` and
`build.target-dir` are instead deliberately overridden by the command's explicit
target and directories, so personal configuration cannot redirect the outputs
away from the paths this script reads. See Cargo's
[build options](https://doc.rust-lang.org/cargo/commands/cargo-build.html) and
[verbose version query](https://doc.rust-lang.org/cargo/commands/cargo-version.html).

To check the producer on a native runner, invoke it from the repository root with
`CARGO_TARGET_DIR` set to a path containing spaces, then inspect the two staged
files. For example, in a POSIX shell:

```sh
CARGO_TARGET_DIR="target/native desktop" pnpm guard --profile broad -- node scripts/buildNativeAddon.ts
```

Setting `CARGO_BUILD_TARGET=wasm32-unknown-unknown` on that invocation must exit
nonzero with `CARGO_BUILD_TARGET must be the native Cargo host ... or host-tuple`
before compilation. Process-boundary doubles cover output routing and staging;
they do not establish actual Windows or Linux compilation, loadability, or package
acceptance. The CI native-parity job invokes this same CLI and requires the staged
addon before loading it for parity checks. Broader native-runner and portable
entry-point acceptance remains tracked in
[#6288](https://github.com/jcosta33/sourdaw/issues/6288).

## Native artifact admission

The electron-builder `afterPack` hook validates the files the shell actually loads:
`Resources/sourdaw-native.node` and `Resources/sourdaw-plugin-scan-helper`
(`.exe` on Windows). Other platforms use the package's `resources` directory.
The expected OS and CPU come from electron-builder's target, never the build host
or the fixed artifact filenames. A host-native Cargo build alone cannot satisfy
a different packaging target.

Before mutating Electron fuses or signing, the hook requires matching thin arm64
macOS Mach-O, x64 Windows PE32+, or x64/arm64 Linux ELF64 artifacts. It checks the
addon/shared-library and helper/executable kinds, inspected header and table bounds,
file-backed extents, and Unix helper execute permissions when the packaging host
exposes Unix mode bits. ELF System V ABI is
accepted for Linux, including position-independent executable helpers. Fat/universal
Mach-O and targets outside the pinned Electron runtime contract are refused.
The subsequent legal-file digest checks, fuse mutation, and fuse readback remain
mandatory. Header reads have a bounded metadata budget; the complete binaries are
not materialized in memory.

This guard establishes target identity and inspected structure. It does not prove
loadability, native ABI compatibility, linked-library availability, complete binary
integrity, signing, installation, or runtime behavior. Its fixture coverage does not
establish that Windows or Linux packages have been built or tested, and admitting
Linux arm64 identity does not add a distribution target.

## Distribution prerequisites

Each offered platform needs native addon and helper builds from the same source
revision on its corresponding native runner, followed by packaging and verification
of the final artifacts. Portable build-entry-point work is tracked in
[#6288](https://github.com/jcosta33/sourdaw/issues/6288).

- The macOS package requires macOS 13 or later, matching its bundled Electron runtime.
- macOS distribution requires a Developer ID signing setup, notarization and
  verification of the downloaded app. `identity: '-'` provides ad-hoc signing only.
  Public macOS release assets are tracked in
  [#2854](https://github.com/jcosta33/sourdaw/issues/2854) and
  [#2860](https://github.com/jcosta33/sourdaw/issues/2860).
- Windows requires its signing setup and an installed-package smoke test on the
  supported Windows baseline. ASIO is not supported by this configuration.
- Linux requires a declared dependency baseline and actual package/install smoke
  testing on the offered distributions.

Release proof must bind the exact final artifacts and checksums to their source
revision, native build evidence, legal material, and runtime verification. On every
offered platform, exercise record → edit → undo/redo → save → reopen → export,
audible output, and native plugin loading/scanning, including failure recovery.
Packaging configuration and header fixtures cannot substitute for those observations.
Signing accounts or services must be chosen separately; this contract chooses or
purchases none. Initial manual downloads are valid; an updater is optional.

## Runtime boundaries

The renderer is packaged in `app.asar`. Native `.node` and linked library files
are unpacked because they must be loaded from the filesystem. Samples are shipped
as resources outside the archive for the same reason.

The macOS entitlement set enables hardened-runtime JIT and third-party native
library loading, and disables the App Sandbox for the current plugin-capable
build. Those settings describe this local package; they are not a claim of
distribution hardening.
