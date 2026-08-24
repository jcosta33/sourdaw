/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

// eslint-disable-next-line import-x/no-default-export
export default defineConfig({
    base: './',
    worker: {
        // Force IIFE format for all worker bundles so each processor file is
        // compiled into a single self-contained script. ES module format (the
        // Rolldown default) creates shared chunks for common dependencies like
        // daw_dsp.js, and those chunk imports can't be resolved from the
        // blob URL context used by AudioWorklet.addModule().
        format: 'iife',
    },
    server: {
        hmr: process.env.NO_HMR !== '1',
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(version),
    },
    esbuild: {
        keepNames: true, // Fixes @grame/faustwasm AudioWorkletNode mangling
    },
    plugins: [
        tanstackRouter({ routesDirectory: './src/routes' }),
        babel({ presets: [reactCompilerPreset()] }),
        react(),
        tailwindcss(),
    ],
    test: {
        environment: 'jsdom',
        /**
         * Two workers is the agent-session ceiling: a lane shares its machine
         * with every other lane and with the resource guard's reservations.
         * CI has neither constraint and a runner has more cores than that, so
         * the shards there raise it. The suite spends far more time building
         * jsdom environments and loading modules than running assertions, so
         * worker count is the lever that moves it.
         */
        maxWorkers: Number(env.VITEST_MAX_WORKERS ?? 2),
        setupFiles: ['./src/setupTests.ts'],
        globals: true,
        /**
         * Local agent worktrees mirror `src/` — exclude so `vitest run` only hits the main tree.
         * The path is `.agents/worktrees/` (see CLAUDE.md); it used to be `.claude/worktrees/`,
         * and the exclusion kept naming the old location for four months after the move, so a
         * root `vitest run` collected every live lane's copy of the whole suite.
         * `pnpm test:collection-scope` now fails the gate if this stops matching.
         */
        exclude: [
            ...configDefaults.exclude,
            'dist/**',
            // `pnpm desktop:dev` compiles `electron/` — specs and all — into this
            // gitignored directory. The sources are collected; the build output of
            // the same sources must not be, or the run doubles up on any machine
            // that has started the shell.
            'electron/out/**',
            '.agents/worktrees/**',
            // The collaboration server owns its node:test suite through
            // `pnpm --dir server test`; Vitest cannot execute it as a suite.
            'server/**',
            'tests/e2e/**',
            '**/*.e2e.spec.*',
        ],
        coverage: {
            all: true,
            provider: 'v8',
            reportsDirectory: './coverage',
            reporter: ['text', 'json', 'html', 'lcov'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                '**/node_modules/**',
                'dist/**',
                '**/*.spec.ts',
                '**/*.spec.tsx',
                'src/vite-env.d.ts',
                'src/app/main.tsx',
            ],
            thresholds: {
                lines: 90,
                statements: 87,
                branches: 76,
                functions: 88,
            },
        },
    },
    resolve: {
        alias: {
            '#': fileURLToPath(new URL('./src', import.meta.url)),
            // @automerge/automerge v3's `browser` export condition resolves to
            // `fullfat_bundler.js`, which uses `import * as wasm from "…bg.wasm"` —
            // the ESM Wasm integration proposal syntax that Rolldown (Vite 8) does
            // not support. The base64 entrypoint is functionally identical but
            // inlines the .wasm as a base64 string, sidestepping the issue entirely.
            '@automerge/automerge': resolve('node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js'),
        },
    },
    preview: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    build: {
        sourcemap: 'hidden',
        chunkSizeWarningLimit: 600,
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        { name: 'vendor-react', test: /node_modules[\\/](react-dom|react)\//, priority: 20 },
                        { name: 'vendor-tanstack', test: /node_modules[\\/]@tanstack/, priority: 15 },
                        { name: 'vendor-ui', test: /node_modules[\\/]@radix-ui/, priority: 10 },
                    ],
                },
            },
        },
    },
});
