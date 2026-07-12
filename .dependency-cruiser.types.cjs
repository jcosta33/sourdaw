/* (c) Copyright Sourdaw Ltd., all rights reserved. */

/*
 * Type-edge cruise: includes `import type` / type-only edges so rules that
 * depend on dependencyTypes: ['type-only'] actually fire.
 *
 * Run via `pnpm deps:validate` (third cruise) with its own known-violations baseline.
 * Cache folder is separate — config is not hashed into the cache key.
 */

const SOURCE_FILE_RE = '[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'no-usecase-type-exports-on-index',
            severity: 'error',
            comment:
                'Contract barrels must not re-export types from useCases/. Types from useCases/ stay private; ' +
                'consumers use ReturnType/Parameters or local shapes; shared payloads go via events/.',
            from: {
                path: '^(src/modules/(?:Common/|Supporting/)?[^/]+)/(index|(useCases|events|stores|presentations/views)/index)\\.ts$',
            },
            to: {
                path: '^$1/useCases/',
                dependencyTypes: ['type-only'],
            },
        },
    ],
    options: {
        doNotFollow: {
            path: ['node_modules'],
        },
        exclude: {
            path: '\\.(spec|test)\\.(ts|tsx)$',
        },
        // Emit type-only edges and tag them so the rule above can match.
        tsPreCompilationDeps: 'specify',
        moduleSystems: ['cjs', 'es6'],
        enhancedResolveOptions: {
            extensions: ['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.d.ts'],
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default', 'types'],
            mainFields: ['module', 'main', 'types', 'typings'],
            aliasFields: ['browser'],
        },
        skipAnalysisNotInRules: true,
        cache: {
            folder: 'node_modules/.cache/dependency-cruiser-types',
            strategy: 'metadata',
            compress: true,
        },
        tsConfig: { fileName: 'tsconfig.json' },
    },
};
