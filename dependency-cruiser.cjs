/* (c) Copyright Frontify Ltd., all rights reserved. */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-cross-module-internals",
      comment:
        "Only contract folders (`errors`, `events`, `useCases` and `presentations/views`) are accessible across modules.",
      severity: "error",
      // Modules in `/src/modules/*`, `/src/modules/Common/*` or in `/src/modules/Supporting/*` are allowed to import from each other.
      from: {
        path: "^(src/modules/|src/modules/Common/|src/modules/Supporting/)([^/]+/)",
      },
      to: {
        path: "^src/modules/",
        // 1. Allows within same module to import from anywhere
        // 2. Allows cross-module imports only from contract folders
        // 3. Allows imports from `_tests`
        pathNot: [
          "^$1$2",
          "^(src/modules/|src/modules/Common/|src/modules/Supporting/)([^/]+/)(errors|events|useCases|presentations/views|_tests)/",
        ],
      },
    },
    {
      name: "cross-module-no-use-cases-in-presentations",
      severity: "error",
      comment:
        "The presentations layer of a module cannot access the use cases of another module, please create a use-case in the current module to handle this.",
      from: {
        path: "^(src/modules/)([^/]+)/presentations/.+",
      },
      to: {
        // Use '.*' to match any sub-path between the module name and 'useCases'
        path: "^$1(?!$2).*/useCases/",
      },
    },
    {
      name: "presentation-stores-private-intra",
      severity: "error",
      comment:
        "Within a module, only that module's presentations layer may import its stores.",
      from: { path: "^(src/modules/)([^/]+)/(?!presentations/).*" },
      to: { path: "^$1$2/presentations/stores/" },
    },
    {
      name: "presentation-stores-private-cross",
      severity: "error",
      comment: "Presentation stores cannot be used by other modules.",
      from: { path: "^(src/modules/)([^/]+)/" },
      to: { path: "^$1(?!$2)[^/]+/presentations/stores/" },
    },
    {
      name: "repositories-only-from-usecases-or-helpers",
      severity: "error",
      comment:
        "Within a module, only useCases and helpers may import that module's repositories.",
      from: {
        // Allow in the same module only useCases and helpers to import from repositories
        path: "^(src/modules/)([^/]+)/(?!useCases/|repositories/|helpers/).*",
      },
      to: {
        path: "^$1$2/repositories/",
      },
    },
    {
      name: "presentations-no-direct-io",
      severity: "error",
      comment: "Presentation layer cannot directly access repositories.",
      from: { path: "^src/modules/(.*)/presentations/.+\\.(ts|tsx)$" },
      to: { path: "^src/modules/$1/repositories/.+\\.(ts|tsx)$" },
    },
    {
      name: "transformers-are-pure",
      severity: "error",
      comment:
        "Transformers must be pure and not import from repositories, stores, or use cases.",
      from: { path: "^src/modules/(.*)/transformers/.+\\.(ts|tsx)$" },
      to: {
        path: "^src/modules/$1/(repositories|presentations/stores|useCases)/.+\\.(ts|tsx)$",
      },
    },
    {
      name: "components-no-usecase-access",
      severity: "error",
      comment:
        "Components cannot access use cases directly. Use hooks or views as intermediaries.",
      from: {
        path: "^src/modules/(.*)/presentations/components/.+\\.(ts|tsx)$",
      },
      to: { path: "^src/modules/$1/useCases/.+\\.(ts|tsx)$" },
    },
    {
      name: "components-no-store-access",
      severity: "error",
      comment:
        "Components cannot access stores directly. They should receive state via props from views.",
      from: {
        path: "^src/modules/(.*)/presentations/components/.+\\.(ts|tsx)$",
      },
      to: { path: "^src/modules/$1/presentations/stores/.+\\.(ts|tsx)$" },
    },
    {
      name: "src-to-application-restrictions",
      comment:
        "Only contract folders (`errors`, `events`, `useCases` and `presentations/views`) are accessible from `src` into `application`.",
      severity: "error",
      from: { path: "^application" },
      to: {
        path: "^src/modules/",
        pathNot: [
          "^src/helpers/",
          "^(src/modules/|src/modules/Common/|src/modules/Supporting/)([^/]+/)(errors|events|useCases|presentations/views)/",
        ],
      },
    },

    /* rules you might want to tweak for your specific situation: */
    {
      name: "not-to-spec",
      comment:
        "This module depends on a spec (test) file. The sole responsibility of a spec file is to test code. " +
        "If there's something in a spec that's of use to other modules, it doesn't have that single " +
        "responsibility anymore. Factor it out into (e.g.) a separate utility/ helper or a mock.",
      severity: "error",
      from: {},
      to: {
        path: "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
      },
    },
    {
      name: "not-to-dev-dep",
      severity: "warn",
      comment:
        "This module depends on an npm package from the 'devDependencies' section of your " +
        "package.json. It looks like something that ships to production, though. To prevent problems " +
        "with npm packages that aren't there on production declare it (only!) in the 'dependencies'" +
        "section of your package.json. If this module is development only - add it to the " +
        "from.pathNot re of the not-to-dev-dep rule in the dependency-cruiser configuration",
      from: {
        path: "^(src)",
        pathNot: "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
      },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
        pathNot: ["node_modules/@types/"],
      },
    },
    {
      name: "optional-deps-used",
      severity: "info",
      comment:
        "This module depends on an npm package that is declared as an optional dependency " +
        "in your package.json. As this makes sense in limited situations only, it's flagged here. " +
        "If you're using an optional dependency here by design - add an exception to your" +
        "dependency-cruiser configuration.",
      from: {},
      to: {
        dependencyTypes: ["npm-optional"],
      },
    },
    {
      name: "peer-deps-used",
      comment:
        "This module depends on an npm package that is declared as a peer dependency " +
        "in your package.json. This makes sense if your package is e.g. a plugin, but in " +
        "other cases - maybe not so much. If the use of a peer dependency is intentional " +
        "add an exception to your dependency-cruiser configuration.",
      severity: "warn",
      from: {},
      to: {
        dependencyTypes: ["npm-peer"],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules"],
    },
    exclude: {
      path: "\\.spec\\.(ts|tsx)$",
    },
    includeOnly: ["src", "application"],
    moduleSystems: ["cjs", "es6"],
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],

      mainFields: ["module", "main", "types", "typings"],
      aliasFields: ["browser"],
    },
    skipAnalysisNotInRules: true,
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/(?:@[^/]+/[^/]+|[^/]+)",
      },
      archi: {
        collapsePattern:
          "^(?:packages|src|lib(s?)|app(s?)|bin|test(s?)|spec(s?))/[^/]+|node_modules/(?:@[^/]+/[^/]+|[^/]+)",
      },
      text: {
        highlightFocused: true,
      },
    },
    tsConfig: { fileName: "tsconfig.json" },
  },
};
