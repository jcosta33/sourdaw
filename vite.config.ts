/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { configDefaults, defineConfig, type Plugin } from 'vitest/config';

import {
    createSourdawRootHeaderMiddleware,
    isSourdawE2eServeMode,
    SOURDAW_E2E_RUN_TOKEN_ENV,
} from './scripts/e2eServerIdentity';
import { sourdawE2eStartupDiagnosticsPlugin } from './scripts/e2eStartupDiagnostics.ts';
import { sourdawE2eUncachedResponsesPlugin } from './scripts/e2eUncachedResponses';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

/**
 * The bindings @grame/faustwasm re-declares in the AudioWorklet module it
 * generates. Its stringified classes reference one another by these source
 * names, so the minifier must not rename them.
 */
const FAUSTWASM_WORKLET_SCOPE_NAMES = [
    'FaustDspInstance',
    'FaustBaseWebAudioDsp',
    'FaustMonoWebAudioDsp',
    'FaustPolyWebAudioDsp',
    'FaustWebAudioDspVoice',
    'FaustWasmInstantiator',
    'Soundfile',
    'WasmAllocator',
    'FaustSensors',
    'FaustAudioWorkletCommunicator',
    'FaustAudioWorkletProcessorCommunicator',
];

/**
 * E2E-only serving-identity marker. Browser verification on a shared machine
 * must prove which checkout answers before reusing a server, so every dev
 * and preview response in `--mode e2e` carries this checkout's vite root, plus
 * the guard-issued run token when the server was started under a recovery
 * proof. The plugin self-gates on the resolved command and mode: plain
 * `pnpm dev`, vitest, and production builds carry no marker.
 */
function sourdawE2eServingCheckoutPlugin(): Plugin {
    return {
        name: 'sourdaw-e2e-serving-checkout',
        apply: (_config, { command, mode }) => command === 'serve' && isSourdawE2eServeMode(mode),
        configureServer(server) {
            server.middlewares.use(
                createSourdawRootHeaderMiddleware(server.config.root, process.env[SOURDAW_E2E_RUN_TOKEN_ENV])
            );
        },
        configurePreviewServer(server) {
            server.middlewares.use(
                createSourdawRootHeaderMiddleware(server.config.root, process.env[SOURDAW_E2E_RUN_TOKEN_ENV])
            );
        },
    };
}

/**
 * @automerge/automerge v3's `browser` export condition resolves to
 * `fullfat_bundler.js`, which uses `import * as wasm from "…bg.wasm"` — the ESM
 * Wasm integration proposal syntax that Rolldown (Vite 8) does not support. The
 * base64 entrypoint is functionally identical but inlines the .wasm as base64.
 * Resolve through `import.meta.resolve` so Node walks up from this config file
 * to the checkout that owns the install (a review worktree has no
 * `node_modules` of its own), then pin the base64 sibling in that entrypoint.
 */
const AUTOMERGE_BASE64_ENTRY = fileURLToPath(
    new URL('./fullfat_base64.js', import.meta.resolve('@automerge/automerge'))
);
const AUTOMERGE_STREAMING_ENTRY = fileURLToPath(
    new URL('./src/infra/automerge/automergeStreamingEntry.ts', import.meta.url)
);

/**
 * Agent lanes and their tooling state live under this checkout's own `.agents/`
 * and mirror the repository, so a change there must not reload the app this
 * checkout serves. The check is anchored to this checkout: the watcher matches
 * absolute paths, and a server running inside a lane has `.agents` in every one
 * of its own source paths.
 */
const AGENT_STATE_DIR = fileURLToPath(new URL('./.agents', import.meta.url));

function isAgentStatePath(file: string): boolean {
    return file === AGENT_STATE_DIR || file.startsWith(AGENT_STATE_DIR + sep);
}

/**
 * Redirects the app build's Automerge import from the base64 entry to the
 * streaming entry. Worker bundles keep base64: build workers use
 * `worker.plugins`, and their IIFE format cannot hold the entry's top-level
 * await. The dev server and Vitest keep it too: dev serves one module URL to
 * the page and to module workers, and Chromium drops messages posted to a
 * worker while its top-level await delays the worker's `onmessage`.
 */
function sourdawAutomergeStreamingEntryPlugin(): Plugin {
    return {
        name: 'sourdaw-automerge-streaming-entry',
        enforce: 'pre',
        apply: 'build',
        resolveId(id, importer) {
            if (id !== AUTOMERGE_BASE64_ENTRY || importer === AUTOMERGE_STREAMING_ENTRY) {
                return null;
            }
            return AUTOMERGE_STREAMING_ENTRY;
        },
    };
}

const DIRECT_PROJECT_SETUP_ENTRY = fileURLToPath(new URL('./tests/e2e/directProjectSetupEntry.ts', import.meta.url));

/**
 * The inspection exports and App must share one emitted module graph.
 * In e2e build mode: emits both entries alongside index.html.
 * In e2e serve mode: rewrites /e2e/direct-project-setup.js to the source TS
 * file so the deterministic URL resolves in both dev and built mode.
 */
function sourdawE2ePersistenceEntryPlugin(): Plugin {
    return {
        name: 'sourdaw-e2e-persistence-entry',
        apply: (_config, { mode }) => mode === 'e2e',
        configureServer(server) {
            server.middlewares.use((req, _res, next) => {
                if (req.url?.split('?')[0] === '/e2e/direct-project-setup.js') {
                    req.url = '/tests/e2e/directProjectSetupEntry.ts';
                }
                next();
            });
        },
        config(_config, { command }) {
            if (command !== 'build') {
                return;
            }
            return {
                build: {
                    rolldownOptions: {
                        input: {
                            index: fileURLToPath(new URL('./index.html', import.meta.url)),
                            'persisted-hydration': fileURLToPath(
                                new URL('./tests/e2e/persistedHydrationEntry.ts', import.meta.url)
                            ),
                            'direct-project-setup': DIRECT_PROJECT_SETUP_ENTRY,
                        },
                        preserveEntrySignatures: 'strict',
                        output: {
                            entryFileNames: (chunk: { name: string }) => {
                                if (chunk.name === 'persisted-hydration') {
                                    return 'e2e/persisted-hydration.js';
                                }
                                if (chunk.name === 'direct-project-setup') {
                                    return 'e2e/direct-project-setup.js';
                                }
                                return 'assets/[name]-[hash].js';
                            },
                        },
                    },
                },
            };
        },
    };
}

// eslint-disable-next-line import-x/no-default-export
export default defineConfig({
    base: './',
    optimizeDeps: {
        // ORT pthreads reuse their module URL; late optimization invalidates that URL during session creation.
        include: ['@automerge/automerge/slim', 'onnxruntime-web'],
    },
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
        watch: { ignored: [isAgentStatePath] },
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(version),
    },
    plugins: [
        tanstackRouter({ routesDirectory: './src/routes' }),
        babel({ presets: [reactCompilerPreset()] }),
        react(),
        tailwindcss(),
        sourdawE2eServingCheckoutPlugin(),
        sourdawE2eStartupDiagnosticsPlugin(),
        sourdawE2eUncachedResponsesPlugin(),
        sourdawE2ePersistenceEntryPlugin(),
        sourdawAutomergeStreamingEntryPlugin(),
    ],
    test: {
        environment: 'jsdom',
        clearMocks: false,
        /**
         * Two workers is the agent-session ceiling: a lane shares its machine
         * with every other lane and with the resource guard's reservations.
         * CI has neither constraint and a runner has more cores than that, so
         * the shards there raise it. The suite spends far more time building
         * jsdom environments and loading modules than running assertions, so
         * worker count is the lever that moves it.
         */
        maxWorkers: Number(env.VITEST_MAX_WORKERS ?? 2),
        setupFiles: env.SOURDAW_VITEST_PROGRESS
            ? ['./scripts/vitestProgressSetup.ts', './src/setupTests.ts']
            : ['./src/setupTests.ts'],
        sequence: { setupFiles: 'list' },
        globals: true,
        /**
         * Agent worktrees and review probe trees mirror `src/` — exclude so `vitest run`
         * only hits the main tree. `.agents/worktrees/` holds author lanes; `.agents/review-worktrees/`
         * holds probe fixtures. `pnpm test:collection-scope` fails the gate if either stops matching.
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
            '.agents/review-worktrees/**',
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
        alias: [
            { find: '#', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
            {
                find: /^@automerge\/automerge\/automerge\.wasm$/,
                replacement: `${fileURLToPath(import.meta.resolve('@automerge/automerge/automerge.wasm'))}?url`,
            },
            // Exact match: a string find would prefix-match and break the
            // `@automerge/automerge/slim` and `/automerge.wasm` subpaths.
            { find: /^@automerge\/automerge$/, replacement: AUTOMERGE_BASE64_ENTRY },
        ],
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
                // @grame/faustwasm builds its AudioWorklet from `var ${Class.name} = ${Class.toString()}`, so minification must keep names.
                keepNames: true,
                // Full minification, as `true` gives, except for the bindings named above.
                minify: { compress: true, mangle: { reserved: FAUSTWASM_WORKLET_SCOPE_NAMES }, codegen: true },
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
