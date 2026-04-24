/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
        setupFiles: ['./src/setupTests.ts'],
        globals: true,
        /** Local agent worktrees mirror `src/` — exclude so `vitest run` only hits the main tree. */
        exclude: [...configDefaults.exclude, 'dist/**', '.claude/**'],
        coverage: {
            all: true,
            provider: 'v8',
            reportsDirectory: './coverage',
            reporter: ['text', 'json', 'html', 'lcov'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                '**/node_modules/**',
                'dist/**',
                'src-tauri/**',
                '**/*.spec.ts',
                '**/*.spec.tsx',
                'src/vite-env.d.ts',
                'src/app/main.tsx',
            ],
            /* thresholds: {
                lines: 100,
                statements: 100,
                branches: 100,
                functions: 100,
                perFile: true,
            }, */
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
