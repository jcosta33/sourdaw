#!/usr/bin/env node
/**
 * Bundles the Electron preload into one CommonJS file at `electron/out/preload.cjs`.
 *
 * The window runs with `sandbox: true`. Electron gives a sandboxed preload a
 * polyfilled `require` that resolves only `electron`, `events`, `timers` and
 * `url`; a relative specifier is not resolvable there at all. So the preload
 * cannot be `tsc`'s per-file output — importing `./bridge.js` would throw
 * "module not found" inside the sandbox and leave `window.sourdaw` undefined,
 * with the renderer reporting nothing beyond a missing global.
 *
 * The output is CommonJS for the same reason: the sandbox loads a preload as
 * CJS, and an ESM one is not executed.
 *
 * `electron` stays external — it is the one specifier the polyfill does resolve,
 * and bundling it would pull the whole module in. Everything else the preload
 * touches lives in `electron/` and is inlined, which is what makes the bridge's
 * command list and channel names one definition shared with the main process
 * rather than a second copy that drifts.
 *
 * Runs after `tsc -p electron/tsconfig.json` in `pnpm desktop:dev`, writing into
 * the same gitignored `electron/out/`.
 */

import { resolve } from 'node:path';

import { build } from 'vite';

const electronDirectory = resolve(import.meta.dirname, '../electron');

await build({
    configFile: false,
    root: electronDirectory,
    // The renderer's plugins, aliases and JSX handling are irrelevant here and
    // the React Compiler preset has no work to do in a preload, so the root
    // config is deliberately not extended.
    logLevel: 'warn',
    build: {
        outDir: resolve(electronDirectory, 'out'),
        // `tsc` has already written this directory, and the renderer bundle is
        // not ours to remove either.
        emptyOutDir: false,
        // Tracks the Node bundled by the pinned Electron major, not the repo's
        // own Node floor — do not bump this alongside `.node-version`.
        target: 'node22',
        // A preload is read by a person debugging a renderer that has no
        // devtools sourcemap for it; the file is small and never shipped hot.
        minify: false,
        sourcemap: true,
        lib: {
            entry: resolve(electronDirectory, 'preload.ts'),
            formats: ['cjs'],
            fileName: () => 'preload.cjs',
        },
        rollupOptions: {
            external: ['electron'],
        },
    },
});
