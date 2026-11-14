# Relinking LGPL Components

Every binary release must offer its exact Sourdaw source archive beside the download under terms
that permit modification and relinking. Install that archive's pinned Node and pnpm versions, then
install dependencies from its lockfile. Desktop releases must also include the complete corresponding
source and build material required to rebuild the shipped Electron FFmpeg library. Do not distribute
a binary without the matching archive. Do not distribute a desktop binary without the matching
Electron FFmpeg source and build material.

## FaustWasm

The runtime package is 0.20.2 under LGPL-2.1-or-later. Its npm gitHead is recorded honestly in
[SOURCES.json](./SOURCES.json); that upstream archive was unavailable. The wrapper's corresponding
source is shipped as `public/legal/faustwasm-0.20.2-corresponding-source.tar.gz` (SHA-256
`7a6f0939e8905e40b7733f8e17cf5c806f3c89fb6c5291985dcc6deb883b3682`).

1. Extract the capsule and follow its `README.md`. `node provision.mjs ../faust-build-cache` verifies
   source inputs and installs the exact locked build tools without lifecycle scripts. Modify the editable
   wrapper/worklet TypeScript, then rebuild with `node build.mjs ./rebuilt-first`. That verification recipe
   requires released bytes; after intentional source modifications, retain its build steps and update the
   expected executable hashes to describe your replacement. Install the rebuilt wrapper as
   `@grame/faustwasm`, preserving Sourdaw's import name. The three small worklet entrypoints and their
   build script are explicitly labeled Sourdaw reconstructions, independently verified against released
   executable bytes; they are not claimed to come from the unavailable upstream commit.
2. To modify the compiler, obtain its version-matched source from
   https://github.com/grame-cncm/faust/archive/21884a6d63713ff99dca2fef95c33aecaedfe643.tar.gz and its
   libraries from https://github.com/grame-cncm/faustlibraries/archive/42fab480c778df7bad5c6b620ca4fd005b2bfe9b.tar.gz.
   The capsule also includes all 55 exact bundled library source files and maps their original paths to
   installed paths. Follow the compiler's upstream build instructions to produce interface-compatible
   `libfaust-wasm.js`, `.data` and `.wasm`; replace the three files under `public/faust/`. A compiler WASM
   rebuild was not part of the wrapper byte-reproduction proof. Another interface-compatible LGPL
   compiler version may also be used.
3. Run `pnpm build` for web or `pnpm desktop:build` for desktop. Preserve the component's license,
   attribution and corresponding source when distributing your replacement.

## lamejs

1. Modify the source pinned in [SOURCES.json](./SOURCES.json) and run its package build.
2. Install the resulting package as `@breezystack/lamejs` without changing Sourdaw's import name.
3. Run `pnpm build` for web or `pnpm desktop:build` for desktop.

## Electron FFmpeg

1. Build an ABI-compatible FFmpeg library from revision
   `9db86ce5b5b454dfc96c435f9f0723012980c37f`, pinned in
   [ELECTRON-SOURCES.json](./ELECTRON-SOURCES.json), or another compatible LGPL version.
2. Replace `libffmpeg.dylib` inside the macOS Electron framework, `libffmpeg.so` on Linux, or
   `ffmpeg.dll` on Windows.
3. Repackage the application. Re-sign macOS and Windows packages after replacement.

Sourdaw adds no integrity check that rejects a compatible replacement. Desktop builds use ad-hoc
macOS signing by default; rebuilding repacks and re-signs the modified application.
