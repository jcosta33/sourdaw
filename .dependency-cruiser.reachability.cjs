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
 *
 * ## Known-violations baseline semantics (depcruiser limitation)
 *
 * `--ignore-known` softens reachability by **module `from` + rule name only**, not
 * by each `to` / `via` edge. The baseline file therefore stores **one compact entry
 * per dirty component** (unique `from`), not thousands of path dumps.
 *
 * Gate meaning for this cruise:
 *   - NEW component `from` that can reach a use case → fails (not in baseline).
 *   - NEW use-case target reachable from an already-baselined component → still
 *     ignored until that component is removed from the baseline.
 *
 * Main cruise dependency rules still match full from+to edges. Do not claim
 * edge-level ratcheting for reachability.
 *
 * Refresh baseline after intentional component cleanups:
 *   depcruise src -c .dependency-cruiser.reachability.cjs -T baseline -f /tmp/r.json
 *   then slim to unique from (or re-run the project’s slim script / keep one row per from).
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
