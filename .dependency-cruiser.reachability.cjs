/* (c) Copyright Sourdaw Ltd., all rights reserved. */

/*
 * Value-import cruise for component → useCases reachability.
 *
 * `from` includes module leaf components and shared `src/components/**` so
 * debt roots like RotaryKnob are identified, not only their consumers.
 *
 * Do NOT use depcruise --ignore-known for this config: that softens by
 * (from + rule name) only. Causal-edge gating lives in
 * scripts/deps-check-reachability.mjs (first useCases hop attributed to the
 * last forbidden-layer file — not every barrel endpoint).
 */

const MODULE = 'src/modules/(?:Common/|Supporting/)?';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'components-no-usecase-transitively',
            severity: 'error',
            comment:
                'Leaf components (module presentations/components and src/components) must not ' +
                'reach use cases — directly or via shared widgets/hooks. Promote to views/hooks ' +
                'or pass callbacks as props. The validate script baselines causal imports only.',
            from: {
                path: `(^${MODULE}[^/]+/presentations/components/|^src/components/).+\\.(ts|tsx)$`,
            },
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
