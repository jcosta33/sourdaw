/* (c) Copyright Sourdaw Ltd., all rights reserved. */

/** @type {import('dependency-cruiser').IConfiguration} */

// Module roots that participate in Sourdaw's bounded-context architecture.
const MODULE_ROOT = '^(src/modules/|src/modules/Common/|src/modules/Supporting/)([^/]+)/';

// Contract folders that are explicitly public across module boundaries.
const MODULE_CONTRACT_FOLDERS = '(errors|events|useCases|stores|presentations/views)/';

// Generic source/test file suffixes.
const SOURCE_FILE_RE = '[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';
const SPEC_FILE_RE = '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';
const STORY_FILE_RE = '[.]stories[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';

module.exports = {
    forbidden: [
        // ─── Cross-module boundary ───────────────────────────────────────────
        {
            name: 'no-cross-module-internals',
            comment:
                'Only contract folders (errors, events, useCases, stores, presentations/views) ' +
                'are accessible across modules. models, repositories, transformers, validators, ' +
                'services, helpers, engine, worklets, and non-view presentation folders are module-private.',
            severity: 'error',
            from: {
                path: MODULE_ROOT,
            },
            to: {
                path: '^src/modules/',
                pathNot: [
                    // Same module: import anything freely
                    '^$1$2',
                    // Cross-module: only contract folders
                    `^${MODULE_ROOT.slice(1)}${MODULE_CONTRACT_FOLDERS}`,
                    // Tests
                    `^${MODULE_ROOT.slice(1)}_tests/`,
                    // Shared primitives (not a module)
                    '^src/shared/',
                ],
            },
        },

        // ─── Presentation internals are private across modules ──────────────
        {
            name: 'presentations-private-cross-default',
            severity: 'error',
            comment:
                'Across modules, only presentations/views/ is public. All other presentations/* ' +
                'folders are module-private by default (hooks, components, renderers, context, stores, etc.).',
            from: { path: MODULE_ROOT },
            to: {
                path: '^$1(?!$2)[^/]+/presentations/(?!views/)',
            },
        },

        // ─── Presentation stores are private even inside the module ─────────
        {
            name: 'presentation-stores-private-intra',
            severity: 'error',
            comment:
                "Within a module, only that module's presentations layer may import its presentations/stores/. " +
                'For cross-module shared state, use business-layer stores/ instead.',
            from: { path: '^' + MODULE_ROOT.slice(1) + '(?!presentations/).*' },
            to: { path: '^$1$2/presentations/stores/' },
        },

        // ─── Models are private within the module ───────────────────────────
        {
            name: 'models-private-cross',
            severity: 'error',
            comment:
                'models/ is module-private. Export DTOs from useCases/ for cross-module type contracts. ' +
                'Shared primitives (TrackId, Beats, Decibels, etc.) belong in src/shared/types/.',
            from: { path: MODULE_ROOT },
            to: { path: '^$1(?!$2)[^/]+/models/' },
        },

        // ─── Validators are private within the module ───────────────────────
        {
            name: 'validators-private-cross',
            severity: 'error',
            comment:
                'validators/ is module-private. Aggregate invariant enforcement is an internal concern. ' +
                "Other modules should call the owning module's useCases/, which internally invoke validators.",
            from: { path: MODULE_ROOT },
            to: { path: '^$1(?!$2)[^/]+/validators/' },
        },

        // ─── Services are private within the module ─────────────────────────
        {
            name: 'services-private-cross',
            severity: 'error',
            comment:
                'services/ is module-private. Stateless cross-entity domain logic is an internal concern. ' +
                "Other modules should call the owning module's useCases/, which internally invoke services.",
            from: { path: MODULE_ROOT },
            to: { path: '^$1(?!$2)[^/]+/services/' },
        },

        // ─── Transformers are private within the module ─────────────────────
        {
            name: 'transformers-private-cross',
            severity: 'error',
            comment:
                'transformers/ is module-private. Mapping logic is an internal concern. ' +
                'Other modules should use DTOs exported from useCases/.',
            from: { path: MODULE_ROOT },
            to: { path: '^$1(?!$2)[^/]+/transformers/' },
        },

        // ─── Repositories: only useCases may import them ────────────────────
        {
            name: 'repositories-only-from-usecases',
            severity: 'error',
            comment: "Within a module, only useCases/ may import that module's repositories/.",
            from: {
                path: '^' + MODULE_ROOT.slice(1) + '(?!useCases/|repositories/).*',
            },
            to: {
                path: '^$1$2/repositories/',
            },
        },
        {
            name: 'presentations-no-direct-io',
            severity: 'error',
            comment:
                'The presentations layer cannot directly access repositories/. ' +
                'Use a hook, adapter, or useCase boundary instead.',
            from: { path: '^' + MODULE_ROOT.slice(1) + 'presentations/.+' + SOURCE_FILE_RE },
            to: { path: '^$1$2/repositories/.+' + SOURCE_FILE_RE },
        },

        // ─── Engine classes are private across modules ──────────────────────
        {
            name: 'engine-private-cross',
            severity: 'error',
            comment:
                'engine/ is module-private. Access engine behaviour through useCases/ contracts. ' +
                'Never import AudioEngine, TrackNode, or other engine classes from another module.',
            from: { path: MODULE_ROOT },
            to: { path: '^$1(?!$2)[^/]+/engine/' },
        },

        // ─── Worklets are heavily isolated ──────────────────────────────────
        {
            name: 'worklets-no-module-runtime-imports',
            severity: 'error',
            comment:
                'AudioWorkletProcessor files in worklets/ run on the audio thread and must not ' +
                'import runtime/business layers such as useCases/, repositories/, stores/, services/, ' +
                'validators/, events/, engine/, or any presentations/* folder.',
            from: { path: '^' + MODULE_ROOT.slice(1) + 'worklets/.+' + SOURCE_FILE_RE },
            to: {
                path:
                    '^$1$2/(useCases|repositories|stores|services|validators|events|engine|presentations)/.+' +
                    SOURCE_FILE_RE,
            },
        },
        {
            name: 'worklets-no-app-or-helper-runtime-imports',
            severity: 'error',
            comment:
                'Worklets must remain isolated from application orchestration, helper runtime layers, and Tauri APIs. ' +
                'Only import worklet-safe/shared primitives explicitly designed for the audio thread.',
            from: { path: '^' + MODULE_ROOT.slice(1) + 'worklets/.+' + SOURCE_FILE_RE },
            to: {
                path: '^(application|src/helpers/|@tauri-apps/)',
            },
        },

        // ─── Transformers must be pure ──────────────────────────────────────
        {
            name: 'transformers-are-pure',
            severity: 'error',
            comment:
                'Transformers must be pure functions. They may not import from repositories/, ' +
                'presentations/stores/, or useCases/.',
            from: { path: '^' + MODULE_ROOT.slice(1) + 'transformers/.+' + SOURCE_FILE_RE },
            to: {
                path: '^$1$2/(repositories|presentations/stores|useCases)/.+' + SOURCE_FILE_RE,
            },
        },

        // ─── Components: no direct useCase or store access ──────────────────
        {
            name: 'components-no-usecase-access',
            severity: 'error',
            comment: 'Components cannot import use cases directly. Access business logic through hooks or views.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'presentations/components/.+' + SOURCE_FILE_RE,
            },
            to: { path: '^$1$2/useCases/.+' + SOURCE_FILE_RE },
        },
        {
            name: 'components-no-store-access',
            severity: 'error',
            comment:
                'Components cannot access presentation stores directly. Receive state via props from views or hooks.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'presentations/components/.+' + SOURCE_FILE_RE,
            },
            to: { path: '^$1$2/presentations/stores/.+' + SOURCE_FILE_RE },
        },

        // ─── Tauri IPC confined to repositories ─────────────────────────────
        {
            name: 'tauri-ipc-only-in-repositories',
            severity: 'error',
            comment:
                'Tauri IPC (invoke, listen) may only be called from repositories/. ' +
                'Use cases and presentations must go through a repository adapter.',
            from: {
                path: '^src/modules/(?!.*repositories/).*' + SOURCE_FILE_RE,
            },
            to: {
                path: '^@tauri-apps/',
            },
        },

        // ─── application ↔ src boundary ─────────────────────────────────────
        {
            name: 'src-to-application-restrictions',
            comment:
                'From application/, only contract folders (errors, events, useCases, stores, ' +
                'presentations/views), src/helpers/, and src/shared/ are accessible.',
            severity: 'error',
            from: { path: '^application' },
            to: {
                path: '^src/modules/',
                pathNot: ['^src/helpers/', '^src/shared/', `^${MODULE_ROOT.slice(1)}${MODULE_CONTRACT_FOLDERS}`],
            },
        },

        // ─── Shared layer must not import from modules ──────────────────────
        {
            name: 'shared-no-module-imports',
            severity: 'error',
            comment:
                'src/shared/ may only contain pure types and pure functions. It must never import from src/modules/.',
            from: { path: '^src/shared/' },
            to: { path: '^src/modules/' },
        },

        // ─── General hygiene ────────────────────────────────────────────────
        {
            name: 'not-to-spec',
            comment:
                'This module depends on a spec/test file. Spec files must only test code. ' +
                'If something inside them is reusable, extract it into a dedicated utility, fixture, or mock.',
            severity: 'error',
            from: {},
            to: {
                path: SPEC_FILE_RE,
            },
        },
        {
            name: 'not-to-story',
            comment:
                'Production code must not depend on Storybook stories. Extract reusable fixtures or ' +
                'presentational helpers into real source modules instead.',
            severity: 'error',
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
            comment:
                'Production code must not depend on fixtures or mocks. Extract reusable data builders ' +
                'into dedicated source modules if needed.',
            severity: 'warn',
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
                "This module depends on an npm package from the 'devDependencies' section of your package.json. " +
                'It looks like something that ships to production, though. To prevent problems with npm packages ' +
                "that aren't there in production, declare it in 'dependencies'. If this module is development-only, " +
                'add an exception to the rule.',
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
            comment:
                'This module depends on an npm package that is declared as an optional dependency. ' +
                'This should be intentional and rare.',
            from: {},
            to: {
                dependencyTypes: ['npm-optional'],
            },
        },
        {
            name: 'peer-deps-used',
            comment:
                'This module depends on an npm package declared as a peer dependency. ' +
                'This is fine for plugins/libraries, but should be intentional.',
            severity: 'warn',
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
            path: '\\.spec\\.(ts|tsx)$',
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
        // Keep this aligned with the tsconfig that owns your path aliases.
        tsConfig: { fileName: 'tsconfig.json' },
    },
};
