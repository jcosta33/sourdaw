# Desktop Packaging

The Electron shell ships as a signed application bundle built by electron-builder from
`electron-builder.yml`. This document states the contracts that layout has to satisfy — what the
shell assumes about where things are, and what a Windows build has to do before it can produce a
working installer.

It complements:

- `Rust Backend Architecture` — the native crate that becomes the packaged addon
- `electron/` — the shell whose path resolution the layout has to match

---

## 1. The packaged layout is a contract with the shell

`electron/protocol.ts` and `electron/native.ts` resolve their inputs by path, branching on
`app.isPackaged`. Packaging is therefore not free to arrange the bundle however it likes:

| What           | Where, packaged                   | Read by                  |
| -------------- | --------------------------------- | ------------------------ |
| Renderer build | `app.asar/dist`                   | `resolveContentRoots`    |
| Sample library | `<Resources>/samples`             | `resolveContentRoots`    |
| Native addon   | `<Resources>/sourdaw-native.node` | `resolveNativeAddonPath` |

Two of those are outside the archive on purpose. The sample loader hands the audio backend real
filesystem paths, and a `.node` addon cannot be `dlopen`ed from inside an asar. Anything else that
has to be a real file on disk — a dylib the addon links against, a future prebuilt module — belongs
in `asarUnpack` or `extraResources` for the same reason, and the rule is that it is listed
explicitly rather than discovered, so adding one is a deliberate act.

The sample library ships exactly once. Vite copies `public/samples/**` into `dist/`, so
`desktop:build` deletes `dist/samples` before packaging and the asar excludes it regardless. A
build that ships both is not wrong so much as a gigabyte heavier for nothing.

## 2. Fuses are part of the security boundary

The shell's runtime hardening — sandboxed renderer, context isolation, permission policy, the
`app://` scheme — is all code, and all of it runs _after_ Electron has decided what to execute.
The fuses decide that earlier question, and they live in bytes patched into the shipped binary.
`scripts/flipElectronFuses.ts` sets them in electron-builder's `afterPack` hook and then re-reads
the wire off disk; a build whose fuses did not take fails there rather than shipping.

Two ordering facts hold the arrangement together. The flip has to happen before signing, because
patching a signed macOS binary invalidates the signature and Apple silicon refuses to launch the
result. And `EnableEmbeddedAsarIntegrityValidation` is only worth anything alongside
`OnlyLoadAppFromAsar` and a signature: the archive's hash lives in `Info.plist`, and it is the code
signature that makes that hash unrewritable. This is why the build ad-hoc signs (`identity: '-'`)
even though it does not distribute — an unsigned bundle would leave the integrity fuse checking a
hash an attacker can edit.

## 3. Hardened runtime entitlements

`build/entitlements.mac.plist` is the macOS entitlement set. Two entries are load bearing beyond
the obvious: `com.apple.security.cs.allow-jit`, without which V8 and the WebAssembly tiering
compiler cannot obtain executable memory under the hardened runtime, and
`com.apple.security.cs.disable-library-validation`, without which neither an ad-hoc signed bundle
nor an unsigned third-party CLAP plugin loads.

## 4. Windows: the addon must be cross-compiled first

The Windows target in `electron-builder.yml` is configuration, not a build that has been run. The
JavaScript half is platform-independent; the blocker is `crates/sourdaw-native`, which compiles to
`sourdaw-native.node` and pulls in C and C++ dependencies (`whisper-rs`, `rusb`, the CLAP host).
Building it for `x86_64-pc-windows-msvc` from macOS or Linux is
[cargo-xwin](https://github.com/rust-cross/cargo-xwin)'s job: it downloads the Microsoft CRT and
Windows SDK headers and drives `clang-cl` and `lld-link` in their place.

The contract a Windows build has to satisfy:

- The addon is built for `x86_64-pc-windows-msvc` — matching `win.target.arch` — with the crate's
  `napi-addon` feature on, and the resulting artifact is renamed to `sourdaw-native.node` before
  packaging. `extraResources` copies `crates/sourdaw-native/*.node`; a wrongly named or
  wrongly-targeted artifact packages silently and fails at `require` time on the user's machine.
- The Metal backend is macOS-only. `whisper-rs`'s feature set is a per-target decision, and a
  Windows build that inherits the macOS features does not link.
- Accepting Microsoft's SDK licence (`--accept-xwin-license` or `XWIN_ACCEPT_LICENSE`) is a
  licensing act, not a build flag. It belongs in a deliberate, recorded decision rather than in a
  script that runs on someone else's machine.

Until an addon built that way exists, the Windows installer produced by this configuration is a
shell with no native surface — which the shell survives, reporting the missing addon at startup,
but which is not a shippable product.
