/* (c) Copyright Webdaw Ltd., all rights reserved. */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        // ─── Cross-module boundary ────────────────────────────────────────────────
        {
            name: 'no-cross-module-internals',
            comment:
                'Only contract folders (errors, events, useCases, stores, presentations/views) ' +
                'are accessible across modules. models, repositories, transformers, validators, ' +
                'services, helpers, engine, worklets, and presentations/hooks/components/renderers/context are module-private.',
            severity: 'error',
            from: {
                path: '^(src/modules/|src/modules/Common/|src/modules/Supporting/)([^/]+/)',
            },
            to: {
                path: '^src/modules/',
                pathNot: [
                    // Same module: import anything freely
                    '^$1$2',
                    // Cross-module: only contract folders
                    '^(src/modules/|src/modules/Common/|src/modules/Supporting/)([^/]+/)(errors|events|useCases|stores|presentations/views)/',
                    // Tests
                    '^(src/modules/|src/modules/Common/|src/modules/Supporting/)([^/]+/)_tests/',
                    // Shared primitives (not a module)
                    '^src/shared/',
                ],
            },
        },


        // ─── Stores are private within the module ─────────────────────────────────
        {
            name: 'presentation-stores-private-intra',
            severity: 'error',
            comment: "Within a module, only that module's presentations layer may import its stores.",
            from: { path: '^(src/modules/)([^/]+)/(?!presentations/).*' },
            to: { path: '^$1$2/presentations/stores/' },
        },
        {
            name: 'presentation-stores-private-cross',
            severity: 'error',
            comment:
                'presentations/stores/ is module-private and cannot be imported by other modules. ' +
                'For cross-module shared state, use a Store<T> at the business layer (stores/ outside presentations/).',
            from: { path: '^(src/modules/)([^/]+)/' },
            to: { path: '^$1(?!$2)[^/]+/presentations/stores/' },
        },

        // ─── Hooks are private within the module ──────────────────────────────────
        {
            name: 'presentations-hooks-private-cross',
            severity: 'error',
            comment:
                'Presentation hooks are module-private and cannot be imported by other modules. ' +
                'Expose behaviour through useCases/ or presentations/views/ instead.',
            from: { path: '^(src/modules/)([^/]+)/' },
            to: { path: '^src/modules/(?!$2)[^/]+/presentations/hooks/' },
        },

        // ─── Models are private within the module ─────────────────────────────────
        {
            name: 'models-private-cross',
            severity: 'error',
            comment:
                'models/ is module-private. Export a DTO from useCases/ for cross-module type contracts. ' +
                'Shared primitives (TrackId, Beats, Decibels, etc.) belong in src/shared/types/.',
            from: { path: '^(src/modules/)([^/]+)/' },
            to: { path: '^src/modules/(?!$2)[^/]+/models/' },
        },

        // ─── Validators are private within the module ──────────────────────────────
        {
            name: 'validators-private-cross',
            severity: 'error',
            comment:
                'validators/ is module-private. Aggregate invariant enforcement is an internal concern. ' +
                'Other modules should call the owning module\'s useCases/, which internally invoke validators.',
            from: { path: '^(src/modules/)([^/]+)/' },
            to: { path: '^src/modules/(?!$2)[^/]+/validators/' },
        },

        // ─── Services are private within the module ────────────────────────────────
        {
            name: 'services-private-cross',
            severity: 'error',
            comment:
                'services/ is module-private. Stateless cross-entity domain logic is an internal concern. ' +
                'Other modules should call the owning module\'s useCases/, which internally invoke services.',
            from: { path: '^(src/modules/)([^/]+)/' },
            to: { path: '^src/modules/(?!$2)[^/]+/services/' },
        },

        // ─── Transformers are private within the module ────────────────────────────
        {
            name: 'transformers-private-cross',
            severity: 'error',
            comment:
                'transformers/ is module-private. Mapping logic is an internal concern. ' +
                'Other modules should use DTOs exported from useCases/.',
            from: { path: '^(src/modules/)([^/]+)/' },
            to: { path: '^src/modules/(?!$2)[^/]+/transformers/' },
        },

        // ─── Renderers are private within the module ───────────────────────────────
        {
            name: 'renderers-private-cross',
            severity: 'error',
            comment:
                'presentations/renderers/ is module-private. Canvas/WebGL/WebGPU drawing code ' +
                'is presentation-layer I/O scoped to the owning module.',
            from: { path: '^(src/modules/)([^/]+)/' },
            to: { path: '^src/modules/(?!$2)[^/]+/presentations/renderers/' },
        },

        // ─── Context is private within the module ──────────────────────────────────
        {
            name: 'context-private-cross',
            severity: 'error',
            comment:
                'presentations/context/ is module-private. Ephemeral UI state (selection, scroll) ' +
                'must never be shared across module boundaries.',
            from: { path: '^(src/modules/)([^/]+)/' },
            to: { path: '^src/modules/(?!$2)[^/]+/presentations/context/' },
        },

        // ─── Components are private within the module ──────────────────────────────
        {
            name: 'components-private-cross',
            severity: 'error',
            comment:
                'presentations/components/ is module-private. Expose reusable UI through ' +
                'presentations/views/ (contract) instead.',
            from: { path: '^(src/modules/)([^/]+)/' },
            to: { path: '^src/modules/(?!$2)[^/]+/presentations/components/' },
        },


        // ─── Repositories: only useCases and helpers may import them ──────────────
        {
            name: 'repositories-only-from-usecases',
            severity: 'error',
            comment: "Within a module, only useCases/ may import that module's repositories/.",
            from: {
                path: '^(src/modules/)([^/]+)/(?!useCases/|repositories/).*',
            },
            to: {
                path: '^$1$2/repositories/',
            },
        },
        {
            name: 'presentations-no-direct-io',
            severity: 'error',
            comment: 'The presentations layer cannot directly access repositories/.',
            from: { path: '^src/modules/(.*)/presentations/.+\\.(ts|tsx)$' },
            to: { path: '^src/modules/$1/repositories/.+\\.(ts|tsx)$' },
        },

        // ─── Engine classes are private ───────────────────────────────────────────
        {
            name: 'engine-private-cross',
            severity: 'error',
            comment:
                'engine/ is module-private. Access audio engine behaviour through useCases/ contracts. ' +
                'Never import AudioEngine, TrackNode, or other engine classes from another module.',
            from: { path: '^(src/modules/)([^/]+)/' },
            to: { path: '^src/modules/(?!$2)[^/]+/engine/' },
        },

        // ─── Worklets are isolated ────────────────────────────────────────────────
        {
            name: 'worklets-isolated',
            severity: 'error',
            comment:
                'AudioWorkletProcessor files in worklets/ run on the audio thread and are isolated. ' +
                'They may not import from useCases/, repositories/, stores/, or any module layer.',
            from: { path: '^src/modules/(.*)/worklets/.+\\.(ts|tsx)$' },
            to: {
                path: '^src/modules/$1/(useCases|repositories|presentations)/.+\\.(ts|tsx)$',
            },
        },

        // ─── Transformers must be pure ────────────────────────────────────────────
        {
            name: 'transformers-are-pure',
            severity: 'error',
            comment:
                'Transformers must be pure functions. They may not import from repositories/, ' +
                'presentations/stores/, or useCases/.',
            from: { path: '^src/modules/(.*)/transformers/.+\\.(ts|tsx)$' },
            to: {
                path: '^src/modules/$1/(repositories|presentations/stores|useCases)/.+\\.(ts|tsx)$',
            },
        },

        // ─── Components: no direct use case or store access ───────────────────────
        {
            name: 'components-no-usecase-access',
            severity: 'error',
            comment: 'Components cannot import use cases directly. ' + 'Access business logic through hooks or views.',
            from: {
                path: '^src/modules/(.*)/presentations/components/.+\\.(ts|tsx)$',
            },
            to: { path: '^src/modules/$1/useCases/.+\\.(ts|tsx)$' },
        },
        {
            name: 'components-no-store-access',
            severity: 'error',
            comment: 'Components cannot access stores directly. ' + 'Receive state via props from views or hooks.',
            from: {
                path: '^src/modules/(.*)/presentations/components/.+\\.(ts|tsx)$',
            },
            to: { path: '^src/modules/$1/presentations/stores/.+\\.(ts|tsx)$' },
        },

        // ─── Tauri IPC confined to repositories ───────────────────────────────────
        {
            name: 'tauri-ipc-only-in-repositories',
            severity: 'error',
            comment:
                'Tauri IPC (invoke, listen) may only be called from repositories/. ' +
                'Use cases and presentations must go through a repository adapter.',
            from: {
                path: '^src/modules/(?!.*repositories/).*\\.(ts|tsx)$',
            },
            to: {
                path: '^@tauri-apps/',
            },
        },

        // ─── application ↔ src boundary ───────────────────────────────────────────
        {
            name: 'src-to-application-restrictions',
            comment:
                'From application/, only contract folders (errors, events, useCases, ' +
                'presentations/views) and src/helpers/ are accessible.',
            severity: 'error',
            from: { path: '^application' },
            to: {
                path: '^src/modules/',
                pathNot: [
                    '^src/helpers/',
                    '^src/shared/',
                    '^(src/modules/|src/modules/Common/|src/modules/Supporting/)([^/]+/)(errors|events|useCases|stores|presentations/views)/',
                ],
            },
        },

        // ─── Shared layer must not import from modules ────────────────────────────
        {
            name: 'shared-no-module-imports',
            severity: 'error',
            comment:
                'src/shared/ may only contain pure types and pure functions. ' +
                'It must never import from src/modules/.',
            from: { path: '^src/shared/' },
            to: { path: '^src/modules/' },
        },

        // ─── General ──────────────────────────────────────────────────────────────
        {
            name: 'not-to-spec',
            comment:
                'This module depends on a spec (test) file. The sole responsibility of a spec ' +
                "file is to test code. If there's something in a spec that's of use to other " +
                "modules, it doesn't have that single responsibility anymore. Factor it out into " +
                'a separate utility/helper or a mock.',
            severity: 'error',
            from: {},
            to: {
                path: '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$',
            },
        },
        {
            name: 'not-to-dev-dep',
            severity: 'warn',
            comment:
                "This module depends on an npm package from the 'devDependencies' section of " +
                'your package.json. It looks like something that ships to production, though. To ' +
                "prevent problems with npm packages that aren't there on production declare it " +
                "(only!) in the 'dependencies' section of your package.json. If this module is " +
                'development only - add it to the from.pathNot re of the not-to-dev-dep rule.',
            from: {
                path: '^(src)',
                pathNot: '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$',
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
                'This module depends on an npm package that is declared as an optional dependency ' +
                "in your package.json. As this makes sense in limited situations only, it's " +
                "flagged here. If you're using an optional dependency here by design - add an " +
                'exception to your dependency-cruiser configuration.',
            from: {},
            to: {
                dependencyTypes: ['npm-optional'],
            },
        },
        {
            name: 'peer-deps-used',
            comment:
                'This module depends on an npm package that is declared as a peer dependency ' +
                'in your package.json. This makes sense if your package is e.g. a plugin, but ' +
                'in other cases - maybe not so much. If the use of a peer dependency is ' +
                'intentional add an exception to your dependency-cruiser configuration.',
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
        tsConfig: { fileName: 'tsconfig.json' },
    },
};
