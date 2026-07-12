/* (c) Copyright Sourdaw Ltd., all rights reserved. */

/*
 * Value-import-only cruise for the reachability rule. Type-only edges are omitted
 * because reachability rules cannot filter dependencyTypesNot — including them
 * would produce false positives on type imports through hooks.
 *
 * Run alongside `.dependency-cruiser.cjs` via `pnpm deps:validate`.
 *
 * Cache does NOT hash this config. Own cache folder so it never shares stale
 * results with the main cruise.
 */

const MODULE = 'src/modules/(?:Common/|Supporting/)?';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'components-no-usecase-transitively',
            severity: 'error',
            comment:
                'Components must not reach use cases — directly or via hooks, same-module or foreign. ' +
                'If a file needs business operations, promote it to presentations/views/ (or a hook under ' +
                'presentations/hooks/ owned by a view). Leaf components receive data/callbacks via props.',
            from: { path: `^${MODULE}[^/]+/presentations/components/.+\\.(ts|tsx)$` },
            to: {
                reachable: true,
                path: `^${MODULE}[^/]+/useCases/.+\\.(ts|tsx)$`,
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
        // Do not use includeOnly: Sourdaw main cruise omits it so React/Tauri npm
        // path rules work; reachability only needs the module graph under src/.
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
            folder: 'node_modules/.cache/dependency-cruiser-reachability',
            strategy: 'metadata',
            compress: true,
        },
        tsConfig: { fileName: 'tsconfig.json' },
    },
};
