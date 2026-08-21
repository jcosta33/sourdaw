# Relinking LGPL Components

Every binary release must offer its exact Sourdaw source archive beside the download under terms
that permit modification and relinking. Install that archive's pinned Node and pnpm versions, then
install dependencies from its lockfile. Desktop releases must also include the complete corresponding
source and build material required to rebuild the shipped Electron FFmpeg library. Do not distribute
a binary without the matching archive. Do not distribute a desktop binary without the matching
Electron FFmpeg source and build material.

## FaustWasm

1. Build a compatible `libfaust-wasm.js`, `.data`, and `.wasm` from the sources pinned in
   [SOURCES.json](./SOURCES.json), or another interface-compatible LGPL version.
2. Replace the three files under `public/faust/`.
3. Run `pnpm build` for web or `pnpm desktop:build` for desktop.

## lamejs

1. Modify the source pinned in [SOURCES.json](./SOURCES.json) and run its package build.
2. Install the resulting package as `@breezystack/lamejs` without changing Sourdaw's import name.
3. Run `pnpm build` for web or `pnpm desktop:build` for desktop.

## Electron FFmpeg

1. Build an ABI-compatible FFmpeg library from revision
   `ad41607c61898cf7150e0fb20fe4bbabd44922a3`, pinned in
   [ELECTRON-SOURCES.json](./ELECTRON-SOURCES.json), or another compatible LGPL version.
2. Replace `libffmpeg.dylib` inside the macOS Electron framework, `libffmpeg.so` on Linux, or
   `ffmpeg.dll` on Windows.
3. Repackage the application. Re-sign macOS and Windows packages after replacement.

Sourdaw adds no integrity check that rejects a compatible replacement. Desktop builds use ad-hoc
macOS signing by default; rebuilding repacks and re-signs the modified application.
