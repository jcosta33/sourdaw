/* (c) Copyright Sourdaw Ltd., all rights reserved. */
/** @type {import('dependency-cruiser').IConfiguration} */

// ----------------------------------------------------------------------------
// `pnpm deps:validate` runs scripts/check-dependency-boundaries.mjs. The script
// executes every cruise with --no-cache and compares current error evidence to
// its exact baseline, rejecting both new and stale rows:
//   1) this main cruise (value + tagged type-only edges; warnings remain visible)
//   2) .dependency-cruiser.reachability.cjs (causal component → useCases edges)
//   3) .dependency-cruiser.types.cjs (type-only boundary edges)
//   4) .dependency-cruiser.tests.cjs (test-inclusive barrel boundaries)
// ----------------------------------------------------------------------------
// Sourdaw TypeScript module architecture enforcement
//
// Module boundary model (contract-folder barrels — migration complete):
//
//   REALIZED STATE: Each module exposes up to four independently-importable
//   contract surfaces. There is no module-root index.ts (0 exist).
//
//     import { addTrack }        from '#/modules/Arrangement/useCases';
//     import { trackStore }      from '#/modules/Arrangement/stores';
//     import type { FooEvent }   from '#/modules/Arrangement/events';
//     import { ArrangementView } from '#/modules/Arrangement/presentations/views';
//
//   cross-module-index-only accepts ONLY the contract-folder form
//   (<module>/<contract>/index.ts). The old root-barrel form (<module>/index.ts,
//   or the bare <module> root) was removed in Tier 1; importing it is
//   unresolvable and fails (not-to-unresolvable) + tsgo.
//
//   Contract-folder barrel rules:
//     - <contract>/index.ts may only re-export from files in its own folder.
//     - No root index.ts in any module.
//     - Same module: use relative paths, never #/modules/<Self>/<contract>.
//
//   Private folders (never importable cross-module):
//     models/, repositories/, services/, validators/, transformers/,
//     presentations/hooks|stores|context|components|renderers/,
//     engine/, worklets/, workers/, runtime/, errors/, handlers/.
//
// Intra-module dependency direction:
//   presentations/ → useCases → repositories / stores / validators / services
//
// ----------------------------------------------------------------------------

// ------------------------------
// Regex helpers
// ------------------------------
const {
    MODELS_MUST_BE_TITLE_CASE,
    MODULE_ROOT,
    SOURCE_FILE_RE,
    SPEC_FILE_RE,
    STORY_FILE_RE,
    DESKTOP_IPC_ONLY_IN_REPOSITORIES,
} = require('./.dependency-cruiser.shared.cjs');

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
        // FORWARD-LOOKING RULES (provisioned, not yet exercised)
        // --------------------------------------------------------------------
        // Several rules below reference structure that is not present in the
        // current flat 34-module tree: the `Common/` / `Supporting/` module
        // subgroups, the `application/` layer, the `presentations/stores/` and
        // `presentations/context/` folders, and the `validators/` / `runtime/` /
        // `worklets/` and `workers/` private folders. They enforce nothing today (no files
        // match), but they guard the intended structure the moment it is added,
        // so they are kept in place deliberately — do not delete them.
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
        // `.agents/skills/architecture-violations/SKILL.md` §4.2 (fake
        // compliance).
        {
            name: 'no-circular',
            // NOTE: the file-level cycles have all been cleared (`depcruise src`
            // reports 0 cycles), so this now lands at `error` to lock in the
            // cleared state. (The previous `warn` premise — ~630 pre-existing
            // barrel-mediated cycles — is stale and no longer applies.)
            severity: 'error',
            comment:
                'Circular dependencies cause non-deterministic module-load order ' +
                '(Vite HMR / Vitest hoisting) and can break inject() runtime resolution. ' +
                '`await import(...)` is NOT a free break — the cycle still exists at runtime, ' +
                'and using dynamic import purely to silence this rule is fake compliance. ' +
                'Prefer extracting shared logic into a third file, flipping an ownership edge, ' +
                'or emitting a signal instead of a call-back.',
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
                '' +
                'Direct imports into models/, repositories/, handlers/, or any non-barrel path are forbidden.',
            from: {
                path: MODULE_ROOT,
            },
            to: {
                path: '^src/modules/',
                pathNot: [
                    '^$1$2', // same module may import its own internals freely
                    // Migration complete: only contract-folder barrels are accepted.
                    // Module-root barrels are no longer allowed (0/34 modules have a root index.ts).
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|events|stores|presentations/views)/index(?:\\.ts)?$',
                    '^src/shared/',
                    '^src/helpers/',
                ],
            },
        },

        {
            name: 'external-module-contracts-only',
            severity: 'error',
            comment:
                'Shared UI, app composition, and routes may import modules only through contract-folder barrels. ' +
                'Private module files remain private outside src/modules/ too.',
            from: {
                path: '^src/(app|components|routes)/',
            },
            to: {
                path: '^src/modules/',
                pathNot:
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|events|stores|presentations/views)/index(?:\\.ts)?$',
            },
        },

        {
            name: 'module-index-contract-only',
            severity: 'error',
            comment:
                'The architecture checker rejects module-root index.ts files outright. If this config is run ' +
                'directly, this defense-in-depth rule prevents a reintroduced root barrel from exporting anything ' +
                'except useCases/, events/, stores/, and presentations/views/ within the same module. ' +
                'Importing from handlers/, models/, repositories/, services/, validators/, transformers/, ' +
                'presentations/hooks/, presentations/components/, presentations/context/, ' +
                'engine/, runtime/, worklets/, or workers/ is forbidden.',
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
            comment:
                'Contract-folder barrels must never import or re-export models, repositories, or transformers from anywhere.',
            from: {
                path: '^(src/modules/(?:Common/|Supporting/)?[^/]+)/(useCases|events|stores|presentations/views)/index\\.ts$',
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
                'Import implementation files directly using relative paths. Root barrels are retired; ' +
                'this also blocks same-module imports of contract-folder index.ts files.',
            from: {
                path: '^' + MODULE_ROOT.slice(1),
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
                path: '^' + MODULE_ROOT.slice(1),
            },
            to: {
                path: '^$1$2/(index\\.ts|(useCases|events|stores|presentations/views)/index\\.ts)$',
            },
        },

        {
            name: 'no-usecase-type-exports-on-index',
            severity: 'error',
            comment:
                'Contract barrels must not re-export types from useCases/. Enforced on the type-edge cruise ' +
                '(.dependency-cruiser.types.cjs with tsPreCompilationDeps: specify). Kept here so the rule ' +
                'name is documented with the main contract set; the types cruise is the hard gate.',
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
            comment:
                'Presentation code must not access services, validators, or transformers directly. Consume use cases instead.',
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
                'Leaf components (module presentations/components and shared src/components) must not ' +
                'import any module useCases/ (same-module or foreign). Route business operations through ' +
                'hooks or views; pass callbacks into leaves as props.',
            from: {
                path: `(^${MODULE_ROOT.slice(1)}presentations/components/|^src/components/).+${SOURCE_FILE_RE}`,
            },
            to: {
                path: 'src/modules/(?:Common/|Supporting/)?[^/]+/useCases/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'components-no-business-store-access',
            severity: 'error',
            comment:
                'Leaf components (module presentations/components and shared src/components) must not ' +
                'import any module business-layer stores/ (same-module or foreign). Views and hooks ' +
                'retain the public read contract; pass state into leaf components as props.',
            from: {
                path: `(^${MODULE_ROOT.slice(1)}presentations/components/|^src/components/).+${SOURCE_FILE_RE}`,
            },
            to: {
                // Any module's business stores (not presentations/stores)
                path: 'src/modules/(?:Common/|Supporting/)?[^/]+/stores/.+' + SOURCE_FILE_RE,
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
            name: 'components-no-view-access',
            severity: 'error',
            comment:
                'Presentational components must not import views (own or foreign). Views compose components; ' +
                'lift data to the parent view and pass it as props.',
            from: {
                path: `(^${MODULE_ROOT.slice(1)}presentations/components/|^src/components/).+${SOURCE_FILE_RE}`,
            },
            to: {
                path: 'src/modules/(?:Common/|Supporting/)?[^/]+/presentations/views/.+' + SOURCE_FILE_RE,
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
            name: 'presentation-no-direct-handlers',
            severity: 'error',
            comment:
                'Presentation code cannot access handlers/ directly. Go through a use case or a presentation hook calling a use case.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'presentations/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/handlers/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'presentation-no-engine-runtime-imports',
            severity: 'error',
            comment: 'Presentation code cannot import engine/, runtime/, worklets/, or workers/ directly.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'presentations/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/(engine|runtime|worklets|workers)/.+' + SOURCE_FILE_RE,
            },
        },

        // --------------------------------------------------------------------
        // Business/core boundaries
        // --------------------------------------------------------------------
        {
            name: 'business-no-presentations',
            severity: 'error',
            comment:
                'Business and IO layers must not import from any presentations/ (own or foreign) — ' +
                'dependencies flow UI → business → IO, never back up. Move the shared code down to the ' +
                'layer that needs it, or keep renderer/UI factories under presentations/ and call them ' +
                'from views/hooks only.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + '(?!presentations/).*' + SOURCE_FILE_RE,
            },
            to: {
                path: 'src/modules/(?:Common/|Supporting/)?[^/]+/presentations/.+' + SOURCE_FILE_RE,
            },
        },

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
            name: 'repositories-no-business',
            severity: 'error',
            comment:
                'Repositories are the IO / persistence edge: they must not import useCases/, handlers/, ' +
                'presentations/, events/, or foreign stores. Orchestration and cross-module contracts belong ' +
                'in use cases. Same-module stores remain allowed for existing thin persistence adapters.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'repositories/.+' + SOURCE_FILE_RE,
            },
            to: {
                path:
                    'src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|handlers|presentations|events|stores)/.+' +
                    SOURCE_FILE_RE,
                pathNot: '^$1$2/stores/',
            },
        },

        {
            name: 'stores-no-same-module-usecase-import',
            severity: 'error',
            comment:
                'Stores are the public read contract; they must not import their own module useCases/. ' +
                'That inverts the declared dependency direction (presentations → useCases → repositories / ' +
                'stores / services). Relocate orchestration into useCases/, or extract a pure predicate / type ' +
                'into models/ so both layers can share it without a store → useCase edge.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'stores/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^$1$2/useCases/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'models-are-pure',
            severity: 'error',
            comment:
                'Domain models are pure module-owned data. They must not import useCases, stores, events, IO, ' +
                'handlers, services, validators, transformers, presentation, engine, worklets, workers, or runtime ' +
                'from any module. Existing Command catalog violations are explicit baseline debt.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'models/.+' + SOURCE_FILE_RE,
            },
            to: {
                path:
                    'src/modules/(?:Common/|Supporting/)?[^/]+/' +
                    '(useCases|repositories|stores|events|handlers|services|validators|transformers|presentations|engine|worklets|workers|runtime)/.+' +
                    SOURCE_FILE_RE,
            },
        },

        {
            name: 'events-are-pure',
            severity: 'error',
            comment:
                'Event contracts must stay pure: same-module events/models and shared utils/infra only. ' +
                'No useCases/, repositories/, stores/, handlers/, presentations/, or engine/ from any ' +
                'module (including foreign contract barrels).',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'events/.+' + SOURCE_FILE_RE,
            },
            to: {
                path:
                    'src/modules/(?:Common/|Supporting/)?[^/]+/' +
                    '(useCases|repositories|stores|handlers|presentations|engine|worklets|workers|runtime|services|validators|transformers)/.+' +
                    SOURCE_FILE_RE,
            },
        },

        {
            name: 'transformers-must-stay-pure',
            severity: 'error',
            comment:
                'Transformers must remain pure. They may not import business, IO, event, UI, engine, or runtime layers.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'transformers/.+' + SOURCE_FILE_RE,
            },
            to: {
                path:
                    'src/modules/(?:Common/|Supporting/)?[^/]+/' +
                    '(repositories|useCases|stores|events|handlers|presentations|engine|worklets|workers|runtime)/.+' +
                    SOURCE_FILE_RE,
            },
        },

        {
            name: 'services-must-stay-pure',
            severity: 'error',
            comment:
                'Services are stateless domain helpers. They may not import use cases, stores, repositories, ' +
                'events, handlers, presentation, engine, worklets, or runtime from any module.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'services/.+' + SOURCE_FILE_RE,
            },
            to: {
                path:
                    'src/modules/(?:Common/|Supporting/)?[^/]+/' +
                    '(useCases|stores|repositories|events|handlers|presentations|engine|worklets|workers|runtime)/.+' +
                    SOURCE_FILE_RE,
            },
        },

        {
            name: 'validators-must-stay-pure',
            severity: 'error',
            comment:
                'Validators are pure domain checks. They may not import use cases, stores, repositories, ' +
                'events, handlers, presentation, engine, worklets, or runtime from any module.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'validators/.+' + SOURCE_FILE_RE,
            },
            to: {
                path:
                    'src/modules/(?:Common/|Supporting/)?[^/]+/' +
                    '(useCases|stores|repositories|events|handlers|presentations|engine|worklets|workers|runtime)/.+' +
                    SOURCE_FILE_RE,
            },
        },

        // --------------------------------------------------------------------
        // Engine / runtime / worklets / workers
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
                    'src/modules/(?:Common/|Supporting/)?[^/]+/' +
                    '(useCases|repositories|stores|services|validators|events|handlers|engine|runtime|presentations)/.+' +
                    SOURCE_FILE_RE,
            },
        },

        {
            name: 'module-runtime-no-worklet-imports',
            severity: 'error',
            comment:
                'Use cases, repositories, stores, handlers, and presentations must not import module worklet internals. ' +
                'The engine-owned AudioWorkletNode is the only application entrypoint for a worklet module.',
            from: {
                path:
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|repositories|stores|handlers|presentations)/.+' +
                    SOURCE_FILE_RE,
            },
            to: {
                path: '^src/modules/(?:Common/|Supporting/)?[^/]+/worklets/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'worklets-no-app-helper-or-desktop-ipc',
            severity: 'error',
            comment: 'Worklets must not depend on application/, src/helpers/, or desktop IPC.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'worklets/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^(application/|src/helpers/|src/utils/desktopBridge\\.ts$)|/@tauri-apps/',
            },
        },

        {
            name: 'workers-no-module-runtime-imports',
            severity: 'error',
            comment:
                'Dedicated Worker files must remain isolated from business, repository, store, engine, runtime, and presentation code.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'workers/.+' + SOURCE_FILE_RE,
            },
            to: {
                path:
                    'src/modules/(?:Common/|Supporting/)?[^/]+/' +
                    '(useCases|repositories|stores|services|validators|events|handlers|engine|runtime|presentations)/.+' +
                    SOURCE_FILE_RE,
            },
        },

        {
            name: 'module-runtime-no-worker-imports',
            severity: 'error',
            comment:
                'Use cases, repositories, stores, handlers, and presentations must not import Worker internals. ' +
                'The engine-owned Worker client is the only application entrypoint for a Worker module.',
            from: {
                path:
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|repositories|stores|handlers|presentations)/.+' +
                    SOURCE_FILE_RE,
            },
            to: {
                path: '^src/modules/(?:Common/|Supporting/)?[^/]+/workers/.+' + SOURCE_FILE_RE,
            },
        },

        {
            name: 'workers-no-app-helper-or-desktop-ipc',
            severity: 'error',
            comment: 'Dedicated Workers must not depend on application/, src/helpers/, or desktop IPC.',
            from: {
                path: '^' + MODULE_ROOT.slice(1) + 'workers/.+' + SOURCE_FILE_RE,
            },
            to: {
                path: '^(application/|src/helpers/|src/utils/desktopBridge\\.ts$)|/@tauri-apps/',
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
                // presentations/ (all module variants) plus legitimate shared-UI
                // and React-binding infra: src/components|app|routes are shared
                // UI; src/infra/store holds the useSyncExternalStore hooks and
                // src/utils/UI holds React UI hooks — all legitimately React.
                pathNot: [
                    ...MODULE_PRESENTATION_PATH_NOT,
                    '^src/components/',
                    '^src/app/',
                    '^src/routes/',
                    '^src/infra/store/',
                    // DialogService: confirm/prompt/notify React views + hooks,
                    // relocated from Workspace presentation into the shared kernel
                    // (ADR 0011 W6.1). React-binding UI infra, like infra/store above.
                    '^src/infra/dialogService/',
                    '^src/utils/UI/',
                ],
            },
            to: {
                // Resolved-path match: the pnpm store resolves a real `import …
                // from 'react'` to a path ending in /react/index.js. The old
                // '^react$|^react/' bare-specifier pattern never matched a
                // resolved path, so this rule silently never fired.
                //
                // We match /react/index PLUS the automatic-runtime entries
                // react/jsx-runtime and react/jsx-dev-runtime. With tsconfig
                // `"jsx": "react-jsx"` the TS compiler injects a react/jsx-runtime
                // import, but only into files that actually contain JSX. Under
                // tsPreCompilationDeps: 'specify' (main options) the cruise reads
                // that real TS program, so pure non-React files (e.g.
                // src/infra/errors/result.ts, src/utils/DOM/createRafBatcher.ts)
                // no longer carry a synthetic jsx-runtime edge. That closed the 2
                // false positives that had blocked PR #339's two-pattern, so the
                // rule now governs the runtime entries too and still lands at
                // error/0: every genuine React consumer (including any explicit
                // react/jsx-runtime import) lives in presentation/shared-UI/binding
                // infra and is exempted via from.pathNot, while a runtime import
                // from business/IO is now correctly flagged.
                path: ['/react/index', 'react/jsx-(?:dev-)?runtime'],
                dependencyTypes: ['npm'],
            },
        },

        {
            name: 'react-dom-only-in-presentation',
            severity: 'error',
            comment: 'react-dom belongs only in presentations/.',
            from: {
                path: '^(src|application)/.+',
                pathNot: [
                    ...MODULE_PRESENTATION_PATH_NOT,
                    '^src/components/',
                    '^src/app/',
                    '^src/routes/',
                    '^src/infra/store/',
                    '^src/infra/dialogService/',
                    '^src/utils/UI/',
                ],
            },
            to: {
                // Resolved-path match (see react-only-in-presentation above).
                path: '/react-dom/',
                dependencyTypes: ['npm'],
            },
        },

        // --------------------------------------------------------------------
        // Desktop IPC confinement
        // --------------------------------------------------------------------
        DESKTOP_IPC_ONLY_IN_REPOSITORIES,

        {
            name: 'app-to-modules-public-surface-only',
            severity: 'error',
            comment:
                'src/app/ may only depend on module contract-folder barrels, src/shared/, and src/helpers/. ' +
                'Migration complete: module-root index.ts is no longer accepted.',
            from: {
                path: '^src/app/',
            },
            to: {
                path: '^src/modules/',
                pathNot: [
                    '^src/shared/',
                    '^src/helpers/',
                    // Migration complete: only contract-folder barrels are accepted.
                    // Module-root barrels are no longer allowed (0/34 modules have a root index.ts).
                    '^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|events|stores|presentations/views)/index(?:\\.ts)?$',
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
            },
            to: {
                path: '^src/modules/',
            },
        },

        {
            name: 'utils-no-module-imports',
            severity: 'error',
            comment: 'src/utils/ must remain module-agnostic and may not import from src/modules/.',
            from: {
                path: '^src/utils/',
            },
            to: {
                path: '^src/modules/',
            },
        },

        {
            name: 'infra-no-module-imports',
            severity: 'error',
            comment: 'src/infra/ must remain module-agnostic and may not import from src/modules/.',
            from: {
                path: '^src/infra/',
            },
            to: {
                path: '^src/modules/',
            },
        },

        // --------------------------------------------------------------------
        // General hygiene
        // --------------------------------------------------------------------
        MODELS_MUST_BE_TITLE_CASE,
        {
            name: 'not-to-unresolvable',
            severity: 'error',
            comment:
                'A dependency could not be resolved (broken or deleted import). Fix the import path or remove the dead import.',
            from: {},
            to: {
                couldNotResolve: true,
            },
        },
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
            severity: 'error',
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
            severity: 'error',
            comment:
                'Production code depends on an npm package listed in devDependencies. Move it to dependencies if it ships.',
            from: {
                path: '^(src|application)',
                // Test-support files legitimately import dev-only test tooling
                // (vitest, @testing-library, mocks). They are excluded from the
                // production bundle, so a dev-dep import there is fine. Without
                // these exemptions, removing includeOnly surfaces 5 such files.
                pathNot: [SPEC_FILE_RE, '__tests__/', '/testing/', 'setupTests', '\\.mock\\.'],
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
        {
            name: 'no-orphans',
            // Specs are excluded from the main graph, so helpers owned by __tests__
            // must be excluded as well. Every remaining row is a production orphan
            // and stays visible until it is integrated or removed.
            severity: 'warn',
            comment:
                'Module is not imported by anything and is not an entry point (orphan). Likely dead code. ' +
                'Warn pending a dead-module cleanup pass.',
            from: {
                orphan: true,
                pathNot: [
                    '\\.d\\.ts$',
                    '(^|/)index\\.ts$',
                    '/testing/',
                    '/__tests__/',
                    'src/main',
                    'src/setupTests',
                    'vite-env',
                    'src/routes/',
                    // Dynamic Worker entrypoints referenced through
                    // new Worker(new URL(..., import.meta.url)).
                    '^src/modules/Transport/workers/schedulerWorker\\.ts$',
                    '^src/modules/MIDI/workers/midiImportWorker\\.ts$',
                    '^src/modules/BrowserAi/workers/tfjsInferenceWorker\\.ts$',
                    '^src/modules/AudioEngine/workers/recordingWorker\\.ts$',
                    // Reachable type/helper files imported by runtime code, but
                    // currently invisible to dependency-cruiser's orphan graph.
                    '^src/utils/DOM/GestureEvent\\.ts$',
                    '^src/modules/Project/useCases/dawProject/dawProjectTypes\\.ts$',
                    '^src/modules/MIDI/useCases/grooveExtraction/helpers\\.ts$',
                    '^src/modules/Collaboration/useCases/collaborationQueries\\.ts$',
                    '^src/modules/AudioEngine/repositories/audioDecoding/wasmDecoding/helpers\\.ts$',
                    '^src/infra/store/storage/LocalStorageKeys\\.ts$',
                ],
            },
            to: {},
        },
    ],

    options: {
        doNotFollow: {
            path: ['node_modules'],
        },
        exclude: {
            path: '\\.(spec|test)\\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$',
        },
        // includeOnly intentionally removed (Tier 2/3 hardening): scoping the graph
        // to src/application pruned the leaf node_modules edge, which made the
        // React/react-dom/desktop-IPC confinement rules silently never match the
        // pnpm-resolved package path. doNotFollow (below) still prevents traversal
        // *into* node_modules while keeping the from→package leaf edge visible.
        // Emit type-only edges (import type / type-position references) into the
        // main graph and tag them, matching .dependency-cruiser.types.cjs. Flipped
        // from the previous default (transpile-only: type-only edges invisible to
        // the main cruise). Under 'specify' the main cruise sees the same graph the
        // types cruise does, so type-only boundary violations can no longer slip
        // past the main contract set, and type-only consumers keep their importers
        // from being miscounted as orphans.
        tsPreCompilationDeps: 'specify',
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
