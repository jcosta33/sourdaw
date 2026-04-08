/* (c) Copyright Sourdaw Ltd., all rights reserved. */
/** @type {import('dependency-cruiser').IConfiguration} */

// ----------------------------------------------------------------------------
// Sourdaw TypeScript module architecture enforcement
//
// Module boundary model:
//
//   Each module MUST expose a root index.ts as its sole public surface.
//   All cross-module imports must target <module>/index.ts — direct imports
//   into useCases/, events/, stores/, or any other folder are forbidden.
//
//   index.ts may only re-export from:
//     - useCases/
//     - events/
//     - stores/
//
//   All other module folders are private — including models/, repositories/,
//   services/, validators/, transformers/, presentations/, engine/, worklets/.
//
// Intra-module dependency direction:
//   presentations/ → useCases → repositories / stores / validators / services
//
// Notes:
// - This config enforces the TARGET architecture.
// - Temporary migration shims can be allowed via narrow exceptions during
//   migration, but those should be added consciously and removed later.
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
        // Cross-module boundaries
        // --------------------------------------------------------------------
        {
            name: 'cross-module-index-only',
            severity: 'error',
            comment:
                'All cross-module imports must target the destination module\'s root index.ts. ' +
                'Direct imports into useCases/, events/, stores/, models/, repositories/, presentations/, ' +
                'or any other internal folder are forbidden from outside the module. ' +
                'Only <module>/index.ts is the public surface.',
            from: {
                path: MODULE_ROOT,
            },
            to: {
                path: '^src/modules/',
                pathNot: [
                    '^$1$2', // same module may import its own internals freely
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/index(?:\\.ts)?$', // any module root index.ts
                    '^src/shared/',
                    '^src/helpers/',
                ],
            },
        },

        {
            name: 'module-index-contract-only',
            severity: 'error',
            comment:
                'Module index.ts is the public contract surface. ' +
                'It may only re-export from useCases/, events/, stores/, and presentations/views/ within the same module. ' +
                'Importing from models/, repositories/, services/, validators/, transformers/, ' +
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

        // --------------------------------------------------------------------
        // Presentation boundaries
        // --------------------------------------------------------------------
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
            comment: 'application/ may only depend on module root index.ts files, src/shared/, and src/helpers/.',
            from: {
                path: '^application/',
            },
            to: {
                path: '^src/modules/',
                pathNot: [
                    '^src/shared/',
                    '^src/helpers/',
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/index(?:\\.ts)?$',
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
