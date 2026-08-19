/* (c) Copyright Sourdaw Ltd., all rights reserved. */

/*
 * Test-inclusive boundary cruise.
 *
 * The main / reachability / type cruises exclude `*.spec.*` / `*.test.*`, so
 * cross-module private imports inside tests are invisible there. This cruise
 * keeps tests in the graph, treats `vi.mock()` targets as dependencies, and
 * enforces barrel boundaries from tests, __tests__ support, and setupTests.ts
 * plus the shared promoted desktop-IPC/model rules. The exact desktopBridge spec mock
 * is the only non-repository desktop-IPC test allowance.
 * Production-only hygiene stays on the main cruise; promoted boundary rules
 * are shared here deliberately because the main cruise excludes specs/tests.
 *
 * Orphan / dev-dependency rules intentionally omitted — those are
 * production-specific and already pathNot-exempt specs on the main cruise.
 *
 * Run via `pnpm deps:validate` with its own known-violations baseline.
 */

const {
    MODELS_MUST_BE_TITLE_CASE,
    MODULE_ROOT,
    SOURCE_FILE_RE,
    DESKTOP_IPC_ONLY_IN_REPOSITORIES,
} = require('./.dependency-cruiser.shared.cjs');

// from: module-rooted test / __tests__ files (keeps $1$2 for same-module pathNot)
const FROM_MODULE_TEST = [
    MODULE_ROOT + '.*\\.(spec|test)' + SOURCE_FILE_RE,
    MODULE_ROOT + '.*__tests__/.*' + SOURCE_FILE_RE,
];

const FROM_EXTERNAL_TEST = [
    '^src/(?!modules/).*[.](spec|test)' + SOURCE_FILE_RE,
    '^src/(?!modules/).*__tests__/.*' + SOURCE_FILE_RE,
    '^src/setupTests\\.ts$',
];

const FROM_ANY_TEST = [...FROM_MODULE_TEST, ...FROM_EXTERNAL_TEST];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        // Promoted rules are shared with the main cruise because that cruise
        // excludes specs/tests from its graph.
        DESKTOP_IPC_ONLY_IN_REPOSITORIES,
        MODELS_MUST_BE_TITLE_CASE,
        {
            name: 'test-dependencies-must-resolve',
            severity: 'error',
            comment:
                'Test imports and vi.mock() targets must resolve. An unresolved target cannot be checked against ' +
                'module boundaries and may hide a retired barrel or misspelled private path.',
            from: {
                path: FROM_ANY_TEST,
            },
            to: {
                couldNotResolve: true,
            },
        },
        {
            name: 'cross-module-index-only',
            severity: 'error',
            comment:
                'Tests must not deep-import foreign module paths. Cross-module imports must ' +
                'target a contract-folder barrel (useCases|events|stores|presentations/views ' +
                'index). Same-module internals remain free.',
            from: {
                path: FROM_MODULE_TEST,
            },
            to: {
                path: '^src/modules/',
                pathNot: [
                    '^$1$2', // same module may import its own internals freely
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|events|stores|presentations/views)/index(?:\\.ts)?$',
                    '^src/shared/',
                    '^src/helpers/',
                ],
            },
        },
        {
            name: 'no-relative-cross-module-imports',
            severity: 'error',
            comment:
                'Cross-module imports must use the #/modules/ alias (even in tests). ' +
                'Relative imports are only allowed within the same module.',
            from: {
                path: FROM_MODULE_TEST,
            },
            to: {
                path: '^src/modules/',
                pathNot: '^$1$2',
                dependencyTypes: ['local'],
                dependencyTypesNot: ['aliased', 'aliased-tsconfig', 'aliased-tsconfig-paths'],
            },
        },
        {
            name: 'module-runtime-no-worklet-imports',
            severity: 'error',
            comment:
                'Module tests in useCases, repositories, stores, handlers, and presentations must not import worklet internals. ' +
                'The engine-owned AudioWorkletNode is the only application entrypoint for a worklet module.',
            from: {
                path: [
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|repositories|stores|handlers|presentations)/.*__tests__/.*' +
                        SOURCE_FILE_RE,
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|repositories|stores|handlers|presentations)/.*\\.(spec|test)' +
                        SOURCE_FILE_RE,
                ],
            },
            to: {
                path: '^src/modules/(?:Common/|Supporting/)?[^/]+/worklets/.+' + SOURCE_FILE_RE,
            },
        },
        {
            name: 'module-runtime-no-worker-imports',
            severity: 'error',
            comment:
                'Module tests in useCases, repositories, stores, handlers, and presentations must not import Worker internals. ' +
                'The engine-owned Worker client is the only application entrypoint for a Worker module.',
            from: {
                path: [
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|repositories|stores|handlers|presentations)/.*__tests__/.*' +
                        SOURCE_FILE_RE,
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|repositories|stores|handlers|presentations)/.*\\.(spec|test)' +
                        SOURCE_FILE_RE,
                ],
            },
            to: {
                path: '^src/modules/(?:Common/|Supporting/)?[^/]+/workers/.+' + SOURCE_FILE_RE,
            },
        },
        {
            name: 'external-tests-contract-only',
            severity: 'error',
            comment:
                'Tests and global test support outside src/modules must use module contract-folder barrels. ' +
                'Private hooks, models, stores, and deep use-case files remain private.',
            from: {
                path: FROM_EXTERNAL_TEST,
            },
            to: {
                path: '^src/modules/',
                pathNot:
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|events|stores|presentations/views)/index(?:\\.ts)?$',
            },
        },
        {
            name: 'external-tests-no-relative-module-imports',
            severity: 'error',
            comment: 'Tests outside src/modules must use #/ contract aliases for module imports.',
            from: {
                path: FROM_EXTERNAL_TEST,
            },
            to: {
                path: '^src/modules/',
                dependencyTypes: ['local'],
                dependencyTypesNot: ['aliased', 'aliased-tsconfig', 'aliased-tsconfig-paths'],
            },
        },
    ],
    options: {
        doNotFollow: {
            path: ['node_modules'],
        },
        // Intentionally no exclude of specs — this is the test-inclusive gate.
        moduleSystems: ['cjs', 'es6'],
        enhancedResolveOptions: {
            extensions: ['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.d.ts'],
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default', 'types'],
            mainFields: ['module', 'main', 'types', 'typings'],
            aliasFields: ['browser'],
        },
        // Include type-only edges so `import type { Track } from '.../models/Track'` is visible.
        tsPreCompilationDeps: true,
        // Mock targets are runtime dependencies of the test harness too.
        exoticRequireStrings: ['vi.mock'],
        skipAnalysisNotInRules: true,
        tsConfig: { fileName: 'tsconfig.json' },
    },
};
