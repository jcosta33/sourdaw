# Relinking LGPL Components

Use the Sourdaw source matching the distributed build. Install its pinned Node and pnpm versions,
then install dependencies from the lockfile.

## FaustWasm

1. Build a compatible `libfaust-wasm.js`, `.data`, and `.wasm` from the sources pinned in
   [SOURCES.json](./SOURCES.json), or another interface-compatible LGPL version.
2. Replace the three files under `public/faust/`.
3. Run `pnpm build` for web or `pnpm desktop:build` for desktop.

## lamejs

1. Modify the source pinned in [SOURCES.json](./SOURCES.json) and run its package build.
2. Install the resulting package as `@breezystack/lamejs` without changing Sourdaw's import name.
3. Run `pnpm build` for web or `pnpm desktop:build` for desktop.

Sourdaw adds no integrity check that rejects a compatible replacement. Desktop builds use ad-hoc
macOS signing by default; rebuilding repacks and re-signs the modified application.
