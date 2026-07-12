/* (c) Copyright Sourdaw Ltd., all rights reserved. */

/*
 * Test-inclusive boundary cruise.
 *
 * The main / reachability / type cruises exclude `*.spec.*` / `*.test.*`, so
 * cross-module private imports inside tests are invisible there. This cruise
 * keeps tests in the graph and enforces barrel boundaries from test and
 * __tests__ support files only (production edges stay on the main cruise).
 *
 * Orphan / dev-dependency rules intentionally omitted — those are
 * production-specific and already pathNot-exempt specs on the main cruise.
 *
 * Run via `pnpm deps:validate` with its own known-violations baseline.
 */

const SOURCE_FILE_RE = '[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';
// Group 1 = prefix, group 2 = module name (same as main config)
const MODULE_ROOT = '^(src/modules/|src/modules/Common/|src/modules/Supporting/)([^/]+)/';

// from: module-rooted test / __tests__ files (keeps $1$2 for same-module pathNot)
const FROM_MODULE_TEST = [
    MODULE_ROOT + '.*\\.(spec|test)' + SOURCE_FILE_RE,
    MODULE_ROOT + '.*__tests__/.*' + SOURCE_FILE_RE,
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
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
        skipAnalysisNotInRules: true,
        cache: {
            folder: 'node_modules/.cache/dependency-cruiser-tests',
            strategy: 'metadata',
            compress: true,
        },
        tsConfig: { fileName: 'tsconfig.json' },
    },
};
