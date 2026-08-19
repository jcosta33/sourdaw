/* (c) Copyright Sourdaw Ltd., all rights reserved. */

/*
 * Type-edge cruise: applies architecture boundary rules to `import type` /
 * type-only edges that the value-edge cruise cannot see.
 *
 * Run via `pnpm deps:validate` (third cruise) with its own known-violations baseline.
 * The architecture checker runs this with --no-cache and exact baseline
 * comparison so repaired debt cannot remain silently authorized.
 */

const mainConfig = require('./.dependency-cruiser.cjs');

const TYPE_ONLY_RULE_NAMES = new Set([
    'cross-module-index-only',
    'external-module-contracts-only',
    'module-index-contract-only',
    'contract-barrel-scope',
    'no-models-repos-transformers-in-index',
    'no-relative-cross-module-imports',
    'no-internal-barrel-import',
    'no-usecase-type-exports-on-index',
    'presentation-no-direct-services-validators-transformers',
    'presentation-stores-private-even-intra-module',
    'presentation-context-private-even-intra-module',
    'components-no-usecase-access',
    'components-no-business-store-access',
    'components-no-presentation-store-access',
    'components-no-view-access',
    'presentation-no-direct-repositories',
    'presentation-no-direct-handlers',
    'presentation-no-engine-runtime-imports',
    'business-no-presentations',
    'usecases-only-write-boundary-to-repositories',
    'repositories-no-business',
    'models-are-pure',
    'events-are-pure',
    'transformers-must-stay-pure',
    'services-must-stay-pure',
    'validators-must-stay-pure',
    'worklets-no-module-runtime-imports',
    'module-runtime-no-worklet-imports',
    'worklets-no-app-helper-or-desktop-ipc',
    'workers-no-module-runtime-imports',
    'module-runtime-no-worker-imports',
    'workers-no-app-helper-or-desktop-ipc',
    'react-only-in-presentation',
    'react-dom-only-in-presentation',
    'desktop-ipc-only-in-repositories',
    'app-to-modules-public-surface-only',
    'shared-no-module-imports',
    'helpers-no-module-imports',
    'utils-no-module-imports',
    'infra-no-module-imports',
]);

const typeOnlyRules = mainConfig.forbidden
    .filter((rule) => TYPE_ONLY_RULE_NAMES.has(rule.name))
    .map((rule) => ({
        ...rule,
        name: rule.name === 'no-usecase-type-exports-on-index' ? rule.name : `${rule.name}-type-only`,
        to: {
            ...rule.to,
            dependencyTypes: ['type-only'],
        },
    }));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: typeOnlyRules,
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
        tsConfig: { fileName: 'tsconfig.json' },
    },
};
