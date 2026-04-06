/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import babel from '@rolldown/plugin-babel';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
    base: './',
    server: {
        hmr: process.env.NO_HMR !== '1',
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
