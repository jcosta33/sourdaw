/* SPDX-FileCopyrightText: Copyright Sourdaw Ltd. */
/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Value-import-only cruise for the reachability rule. Type-only edges are omitted
 * because reachability rules cannot filter dependencyTypesNot — including them
 * would produce false positives on type imports through hooks.
 *
 * The architecture checker collapses the endpoint matrix to causal edges: the
 * last leaf component on a path → the first useCases node. It compares those
 * exact edges to the baseline and rejects both new and stale debt.
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
                'reach use cases — directly or via hooks. Promote to views/hooks or pass callbacks ' +
                'as props.',
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
        tsConfig: { fileName: 'tsconfig.json' },
    },
};
