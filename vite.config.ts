/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { searchForWorkspaceRoot } from 'vite';
import { configDefaults, defineConfig, type Plugin } from 'vitest/config';

import { createSourdawRootHeaderMiddleware, isSourdawE2eServeMode } from './scripts/e2eServerIdentity';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

/**
 * A review worktree has no install of its own, so without this Vite refuses
 * package assets imported with `?url` that sit in the checkout's node_modules.
 */
function resolveInstallNodeModulesDir(): string {
    const viteModuleUrl = import.meta.resolve('vite');
    const viteModulePath = fileURLToPath(viteModuleUrl);
    const nodeModulesIndex = viteModulePath.indexOf(`${sep}node_modules${sep}`);
    if (nodeModulesIndex === -1) {
        throw new Error(`Failed to resolve node_modules directory from vite module path: ${viteModulePath}`);
    }
    return viteModulePath.slice(0, nodeModulesIndex + sep.length + 'node_modules'.length);
}

/**
 * E2E-only serving-identity marker. Browser verification on a shared machine
 * must prove which checkout answers before reusing a server, so every dev
 * response in `--mode e2e` carries this checkout's vite root. The plugin
 * self-gates on the resolved command and mode: plain `pnpm dev`, vitest, and
 * production builds carry no marker.
 */
function sourdawE2eServingCheckoutPlugin(): Plugin {
    return {
        name: 'sourdaw-e2e-serving-checkout',
        apply: (_config, { command, mode }) => command === 'serve' && isSourdawE2eServeMode(mode),
        configureServer(server) {
            server.middlewares.use(createSourdawRootHeaderMiddleware(server.config.root));
        },
    };
}

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
        fs: {
            allow: [searchForWorkspaceRoot(process.cwd()), resolveInstallNodeModulesDir()],
        },
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
        sourdawE2eServingCheckoutPlugin(),
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
            // The collaboration server's specs use node:test and are owned by
            // `pnpm health:server:full`, not the root Vitest harness.
            'server/**',
            '.agents/worktrees/**',
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
            // Resolve through `import.meta.resolve` so Node walks up from this config
            // file to the checkout that owns the install (a review worktree has no
            // `node_modules` of its own), then pin the base64 sibling in that entrypoint.
            '@automerge/automerge': fileURLToPath(
                new URL('./fullfat_base64.js', import.meta.resolve('@automerge/automerge'))
            ),
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
