/* (c) Copyright Sourdaw Ltd., all rights reserved. */
/** @type {import('dependency-cruiser').IConfiguration} */

// ----------------------------------------------------------------------------
// Sourdaw TypeScript module architecture enforcement
//
// Module boundary model (contract-folder barrels — migration in progress 2026-04-10):
//
//   TARGET STATE: Each module exposes four independently-importable contract
//   surfaces. No module-root index.ts.
//
//     import { addTrack }        from '#/modules/Arrangement/useCases';
//     import { trackStore }      from '#/modules/Arrangement/stores';
//     import type { FooEvent }   from '#/modules/Arrangement/events';
//     import { ArrangementView } from '#/modules/Arrangement/presentations/views';
//
//   TRANSITIONAL: cross-module-index-only currently accepts BOTH the old root-
//   barrel form (<module>/index.ts) AND the new contract-folder form
//   (<module>/<contract>/index.ts). The root-barrel form will be removed once
//   every module is migrated. See .agents/specs/contract-folder-barrels.md.
//
//   Contract-folder barrel rules (target state):
//     - <contract>/index.ts may only re-export from files in its own folder.
//     - No root index.ts in a fully-migrated module.
//     - Same module: use relative paths, never #/modules/<Self>/<contract>.
//
//   Private folders (never importable cross-module):
//     models/, repositories/, services/, validators/, transformers/,
//     presentations/hooks|stores|context|components|renderers/,
//     engine/, worklets/, runtime/, errors/, handlers/.
//
// Intra-module dependency direction:
//   presentations/ → useCases → repositories / stores / validators / services
//
// ----------------------------------------------------------------------------

// ------------------------------
// Regex helpers
// ------------------------------
const SOURCE_FILE_RE = '[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';
const SPEC_FILE_RE = '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';
const STORY_FILE_RE = '[.]stories[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';

// Group 1 = prefix ("src/modules/" or Common/Supporting variant)
// Group 2 = module name
const MODULE_ROOT = '^(src/modules/|src/modules/Common/|src/modules/Supporting/)([^/]+)/';

// Private presentation subfolders
const PRIVATE_PRESENTATION_FOLDERS =
    '(presentations/hooks/|presentations/stores/|presentations/context/|presentations/components/|presentations/renderers/)';

const MODULE_PRESENTATION_PATH_NOT = [
    '^src/modules/[^/]+/presentations/',
    '^src/modules/Common/[^/]+/presentations/',
    '^src/modules/Supporting/[^/]+/presentations/',
];

// ------------------------------
// Config
// ------------------------------
module.exports = {
    forbidden: [
        // --------------------------------------------------------------------
        // Circular dependencies
        // --------------------------------------------------------------------
        // Reports any cycle in the dependency graph, including cycles where one
        // or more edges use `await import(...)`. Dynamic import is NOT a free
        // escape hatch — it changes the static graph shape but the two modules
        // are still bidirectionally coupled at runtime, and `await import()` in
        // a hot path (e.g. audio scheduling) adds real promise/chunk overhead.
        //
        // The `dependencyTypesNot: ['dynamic-import']` filter below only
        // suppresses the reported edge when the *direct* from→to edge is dynamic
        // (it does not exclude the cycle if any other edge is static). That
        // matches the de-facto behaviour this project has been validating
        // against — cycles surface so each instance gets architectural scrutiny.
        //
        // Genuine table-driven dispatcher recursion (`executeAppAction` ↔
        // handlers) is the only case where `await import()` is structurally
        // unavoidable. For every other cycle, prefer a real fix: extract shared
        // logic into a third file, flip an ownership edge, or emit a
        // signal/event instead of calling back. See
        // `.agents/audits/circular-dependencies.md` and
        // `.agents/skills/architecture-violations/SKILL.md` §4.2 (fake
        // compliance).
        {
            name: 'no-circular',
            // NOTE: severity is `warn` (not `error`) because enabling this rule surfaces
            // ~630 pre-existing barrel-mediated cycles that pre-date this rule.
            // The 38 file-level cycles documented in
            // `.agents/audits/circular-dependencies.md` have all been cleared (Patterns A–E).
            // Landing as `error` requires a separate cleanup pass for the barrel cycles.
            severity: 'warn',
            comment:
                'Circular dependencies cause non-deterministic module-load order ' +
                '(Vite HMR / Vitest hoisting) and can break inject() runtime resolution. ' +
                '`await import(...)` is NOT a free break — the cycle still exists at runtime, ' +
                'and using dynamic import purely to silence this rule is fake compliance. ' +
                'Prefer extracting shared logic into a third file, flipping an ownership edge, ' +
                'or emitting a signal instead of a call-back. ' +
                'Currently `warn` pending the barrel-cycle cleanup tracked in the circular-dependencies audit.',
            from: {},
            to: {
                circular: true,
                dependencyTypesNot: ['dynamic-import'],
            },
        },

        // --------------------------------------------------------------------
        // Cross-module boundaries
        // --------------------------------------------------------------------
        {
            name: 'cross-module-index-only',
            severity: 'error',
            comment:
                'Cross-module imports must target a contract-folder barrel: ' +
                '<module>/useCases/index.ts, <module>/stores/index.ts, ' +
                '<module>/events/index.ts, or <module>/presentations/views/index.ts. ' +
                'During migration, the old <module>/index.ts root-barrel form is also accepted. ' +
                'Direct imports into models/, repositories/, handlers/, or any non-barrel path are forbidden. ' +
                'See .agents/specs/contract-folder-barrels.md for the target state.',
            from: {
                path: MODULE_ROOT,
            },
            to: {
                path: '^src/modules/',
                pathNot: [
                    '^$1$2', // same module may import its own internals freely
                    // TRANSITIONAL: accept both old root-barrel AND new contract-folder barrels.
                    // Remove the root-barrel alternative once all modules are migrated.
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(index|(useCases|events|stores|presentations/views)/index)(?:\\.ts)?$',
                    '^src/shared/',
                    '^src/helpers/',
                ],
            },
        },

        {
            name: 'module-index-contract-only',
            severity: 'error',
            comment:
                'Module root index.ts (legacy, during migration) may only re-export from useCases/, events/, stores/, ' +
                'and presentations/views/ within the same module. ' +
                'Importing from handlers/, models/, repositories/, services/, validators/, transformers/, ' +
                'presentations/hooks/, presentations/components/, presentations/context/, ' +
                'engine/, runtime/, or worklets/ is forbidden.',
            from: {
                path: '^(src/modules/(?:Common/|Supporting/)?[^/]+)/index\\.ts$',
            },
            to: {
                path: '^$1/',
                pathNot: ['^$1/(useCases|events|stores|presentations/views)/'],
            },
        },

        {
            name: 'contract-barrel-scope',
            severity: 'error',
            comment:
                'A contract-folder barrel (<module>/<contract>/index.ts) may only re-export ' +
                'from files within its own folder (<module>/<contract>/). ' +
                'Importing from sibling contract folders, models/, repositories/, or other private ' +
                'folders is forbidden — each barrel has a self-contained scope.',
            from: {
                path: '^(src/modules/(?:Common/|Supporting/)?[^/]+)/(useCases|events|stores|presentations/views)/index\\.ts$',
            },
            to: {
                path: '^$1/',
                pathNot: ['^$1/$2/'],
            },
        },

        {
            name: 'no-models-repos-transformers-in-index',
            severity: 'error',
            comment: 'Module index.ts files must never import or re-export models, repositories, or transformers from anywhere.',
            from: {
                path: '^(src/modules/(?:Common/|Supporting/)?[^/]+)/index\\.ts$',
            },
            to: {
                path: '/(models|repositories|transformers)/',
            },
        },

        {
            name: 'no-relative-cross-module-imports',
            severity: 'error',
            comment:
                'Cross-module imports must use the #/modules/ alias and target a barrel. ' +
                'Relative imports (../../) are only allowed within the same module.',
            from: {
                path: MODULE_ROOT,
            },
            to: {
                path: '^src/modules/',
                pathNot: '^$1$2', // target path must NOT start with the same module root
                dependencyTypes: ['local'], // dependency-cruiser marks both relative and tsconfig-alias imports as local
                dependencyTypesNot: ['aliased', 'aliased-tsconfig', 'aliased-tsconfig-paths'],
            },
        },

        {
            name: 'no-internal-barrel-import',
            severity: 'error',
            comment:
                'Internal module files must not import from their own module barrels (index.ts). ' +
                'Import implementation files directly using relative paths.',
            from: {
                // Legacy module-root barrels remain allowed during migration.
                // This rule targets non-root files (including contract-folder barrels)
                // importing another index.ts inside the same module.
                path: '^' + MODULE_ROOT.slice(1) + '(?!index\\.ts$)',
            },
            to: {
                path: '^$1$2/.*/index\\.ts$',
            },
        },

        {
            name: 'no-self-barrel-import',
            severity: 'error',
            comment:
                'Files inside a module must not import from their own module root index.ts or contract-folder barrels. ' +
                'Use relative paths to the implementation files.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + '(?!index\\.ts)',
            },
            to: {
                path: '^$1$2/(index\\.ts|(useCases|events|stores|presentations/views)/index\\.ts)$',
            },
        },

        {
            name: 'no-usecase-type-exports-on-index',
            severity: 'error',
            comment:
                'Module index.ts files (root or contract-folder) must not re-export types from useCases/. ' +
                'Types from useCases/ are private. Other modules should use ReturnType/Parameters or define local shapes.',
            from: {
                path: '^(src/modules/(?:Common/|Supporting/)?[^/]+)/(index|(useCases|events|stores|presentations/views)/index)\\.ts$',
            },
            to: {
                path: '^$1/useCases/',
                dependencyTypes: ['type-only'],
            },
        },

        // --------------------------------------------------------------------
        // Presentation boundaries
        // --------------------------------------------------------------------
        {
            name: 'presentation-no-direct-services-validators-transformers',
            severity: 'error',
            comment: 'Presentation code must not access services, validators, or transformers directly. Consume use cases instead.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'presentations/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/(services|validators|transformers)/.+' + SOURCE_FILE_RE,
            },
        },
        {
            name: 'presentation-stores-private-even-intra-module',
            severity: 'error',
            comment:
                'presentations/stores/ are private to the presentation layer. Use business-layer stores/ for shared state.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + '(?!presentations/).*' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/presentations/stores/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'presentation-context-private-even-intra-module',
            severity: 'error',
            comment:
                'presentations/context/ is private to the presentation layer and should not be imported from business layers.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + '(?!presentations/).*' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/presentations/context/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'components-no-usecase-access',
            severity: 'error',
            comment:
                'Presentational components must not import use cases directly. Route business operations through hooks or views.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'presentations/components/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/useCases/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'components-no-business-store-access',
            severity: 'error',
            comment:
                'Presentational components must not import business-layer stores directly. Receive state via hooks or props.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'presentations/components/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/stores/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'components-no-presentation-store-access',
            severity: 'error',
            comment: 'Presentational components must not import presentation stores directly. Use hooks or props.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'presentations/components/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/presentations/stores/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'presentation-no-direct-repositories',
            severity: 'error',
            comment:
                'Presentation code cannot access repositories directly. Go through a use case or a presentation hook calling a use case.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'presentations/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/repositories/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'presentation-no-engine-runtime-imports',
            severity: 'error',
            comment: 'Presentation code cannot import engine/, runtime/, or worklets/ directly.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'presentations/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/(engine|runtime|worklets)/.+' + SOURCE_FILE_RE,
            },
        },

        // --------------------------------------------------------------------
        // Business/core boundaries
        // --------------------------------------------------------------------
        {
            name: 'usecases-only-write-boundary-to-repositories',
            severity: 'error',
            comment: 'Within a module, only useCases/ may orchestrate repositories/.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + '(?!useCases/|repositories/).*' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/repositories/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'transformers-must-stay-pure',
            severity: 'error',
            comment:
                'Transformers must remain pure. They may not import repositories/, useCases/, or presentation-layer stores.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'transformers/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/(repositories|useCases|presentations/stores)/.+' + SOURCE_FILE_RE,
            },
        },

        // --------------------------------------------------------------------
        // Engine / runtime / worklets
        // --------------------------------------------------------------------
        {
            name: 'worklets-no-module-runtime-imports',
            severity: 'error',
            comment:
                'AudioWorklet files must remain isolated from business, repository, engine, runtime, and presentation code.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'worklets/.+' + SOURCE_FILE_RE,
            },
            to: {
                path:
                    '^$1$2/(useCases|repositories|stores|services|validators|events|engine|runtime|presentations)/.+' +
                    SOURCE_FILE_RE,
            },
        },

        {
            name: 'worklets-no-app-helper-or-tauri',
            severity: 'error',
            comment: 'Worklets must not depend on application/, src/helpers/, or Tauri APIs.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'worklets/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^(application/|src/helpers/|@tauri-apps/)',
            },
        },

        // --------------------------------------------------------------------
        // React confinement
        // --------------------------------------------------------------------
        {
            name: 'react-only-in-presentation',
            severity: 'error',
            comment: 'React belongs only in presentations/. Business and I/O layers must stay React-free.',
            from: {
                path: '^(src|application)/.+',
                pathNot: MODULE_PRESENTATION_PATH_NOT,
            },
            to: {
                path: '^react$|^react/',
            },
        },

        {
            name: 'react-dom-only-in-presentation',
            severity: 'error',
            comment: 'react-dom belongs only in presentations/.',
            from: {
                path: '^(src|application)/.+',
                pathNot: MODULE_PRESENTATION_PATH_NOT,
            },
            to: {
                path: '^react-dom$|^react-dom/',
            },
        },

        // --------------------------------------------------------------------
        // Tauri confinement
        // --------------------------------------------------------------------
        {
            name: 'tauri-ipc-only-in-repositories',
            severity: 'error',
            comment:
                'Tauri IPC (invoke, listen, Channel APIs) may only be used from repositories/. The shell is accessed through adapters, not use cases or presentation.',
            from: {
                path: '^(src/modules/)(?!.*repositories/).*' + SOURCE_FILE_RE,
            },
            to: {
                path: '^@tauri-apps/',
            },
        },

        {
            name: 'application-to-modules-public-surface-only',
            severity: 'error',
            comment:
                'application/ may only depend on module contract-folder barrels, src/shared/, and src/helpers/. ' +
                'During migration, root index.ts is also accepted.',
            from: {
                path: '^application/',
            },
            to: {
                path: '^src/modules/',
                pathNot: [
                    '^src/shared/',
                    '^src/helpers/',
                    // TRANSITIONAL: accept both old root-barrel AND new contract-folder barrels.
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(index|(useCases|events|stores|presentations/views)/index)(?:\\.ts)?$',
                ],
            },
        },

        // --------------------------------------------------------------------
        // Shared / helpers purity
        // --------------------------------------------------------------------
        {
            name: 'shared-no-module-imports',
            severity: 'error',
            comment: 'src/shared/ must remain module-agnostic and may not import from src/modules/.',
            from: {
                path: '^src/shared/',
            },
            to: {
                path: '^src/modules/',
            },
        },

        {
            name: 'helpers-no-module-imports',
            severity: 'error',
            comment: 'src/helpers/ must not become a shadow architecture layer for module-specific behavior.',
            from: {
                path: '^src/helpers/',
                pathNot: '^src/helpers/Store/Storage/AutomergeStorage\\.ts$',
            },
            to: {
                path: '^src/modules/',
            },
        },

        // --------------------------------------------------------------------
        // General hygiene
        // --------------------------------------------------------------------
        // {
        //     name: 'models-must-be-title-case',
        //     severity: 'error',
        //     comment: 'Files inside models/ must start with an uppercase letter (TitleCase). Domain entities should be clearly named nouns. Constants should be co-located with their relevant domain entity file.',
        //     from: {},
        //     to: {
        //         path: '^' + MODULE_ROOT.slice(1) + 'models/[a-z].*' + SOURCE_FILE_RE,
        //     },
        // },
        {
            name: 'not-to-spec',
            severity: 'error',
            comment: 'Production code must not depend on spec/test files.',
            from: {},
            to: {
                path: SPEC_FILE_RE,
            },
        },
        {
            name: 'not-to-story',
            severity: 'error',
            comment: 'Production code must not depend on Storybook stories.',
            from: {
                path: '^(src|application)/',
                pathNot: SPEC_FILE_RE,
            },
            to: {
                path: STORY_FILE_RE,
            },
        },
        {
            name: 'not-to-fixture-or-mock',
            severity: 'warn',
            comment: 'Production code should not depend on fixtures or mocks.',
            from: {
                path: '^(src|application)/',
                pathNot: SPEC_FILE_RE,
            },
            to: {
                path: '(^|/)(__fixtures__|fixtures|mocks?)/',
            },
        },
        {
            name: 'not-to-dev-dep',
            severity: 'warn',
            comment:
                'Production code depends on an npm package listed in devDependencies. Move it to dependencies if it ships.',
            from: {
                path: '^(src|application)',
                pathNot: SPEC_FILE_RE,
            },
            to: {
                dependencyTypes: ['npm-dev'],
                dependencyTypesNot: ['type-only'],
                pathNot: ['node_modules/@types/'],
            },
        },
        {
            name: 'optional-deps-used',
            severity: 'info',
            comment: 'Optional dependency used; this should be intentional.',
            from: {},
            to: {
                dependencyTypes: ['npm-optional'],
            },
        },
        {
            name: 'peer-deps-used',
            severity: 'warn',
            comment: 'Peer dependency used; this should be intentional.',
            from: {},
            to: {
                dependencyTypes: ['npm-peer'],
            },
        },
    ],

    options: {
        doNotFollow: {
            path: ['node_modules'],
        },
        exclude: {
            path: '\\.(spec|test)\\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$',
        },
        includeOnly: ['src', 'application'],
        moduleSystems: ['cjs', 'es6'],
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default', 'types'],
            mainFields: ['module', 'main', 'types', 'typings'],
            aliasFields: ['browser'],
        },
        skipAnalysisNotInRules: true,
        reporterOptions: {
            dot: {
                collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)',
            },
            archi: {
                collapsePattern:
                    '^(?:packages|src|lib(s?)|app(s?)|bin|test(s?)|spec(s?))/[^/]+|node_modules/(?:@[^/]+/[^/]+|[^/]+)',
            },
            text: {
                highlightFocused: true,
            },
        },
        tsConfig: { fileName: 'tsconfig.json' },
    },
};
