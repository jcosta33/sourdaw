# Lint engine ownership

`scripts/runLint.ts` runs the existing native `.oxlintrc.json` pass, the public JavaScript
plugins in `.oxlint-plugins.json`, then the retained `eslint.config.mjs` pass. The plugin
pass deliberately uses the old ESLint target and ignore set: the native pass excludes
some JavaScript tooling and existing TypeScript debt that still needs these checks.
The native phase permits an unmatched selection so an intentionally ignored focused
target can reach those enforcing passes. The plugin phase still rejects an empty
selection, and ESLint still rejects missing target paths.

The plugin config spells out the effective preset settings, promotions, and scoped
exceptions. Preserve those settings when upgrading plugins; loading a package does not
load its ESLint preset. `sourdaw.mjs` owns the local AST rules and their filename policies.
Its type-query accessor accepts Oxc's `TSImportType.source` string literal as well as
the original TypeScript parser's `argument` representation; neither route resolves
dynamic expressions.

Oxlint reserves native plugin names. Public plugin rules therefore use
`react-hooks-js/`, `promise-js/`, and `jsx-a11y-x-js/` in configurations and inline disable
comments. The remaining plugin names stay unchanged. ESLint registers these names
without enabling moved rules, so the split passes accept each other's suppressions.
Unused-disable reporting remains off because neither pass observes all rules.

ESLint remains necessary for `@eslint-react/no-leaked-conditional-rendering`,
`@tanstack/query/no-void-query-fn`, `@tanstack/query/no-rest-destructuring`, and
`@typescript-eslint/naming-convention`: their existing behavior needs TypeScript
parser services that Oxlint's public JS-plugin API does not supply. Native tsgolint
does not expose its type checker to JS plugins. The recommended eslint-comments
rules also stay in ESLint: their blanket-directive diagnostics deliberately use
column `-1`, which Oxlint rejects as an out-of-range location. `import-x/order` retains its ordered
TypeScript and Node resolver functions. Core rules retain their ESLint implementations
and the existing size baseline rather than assuming that a similarly named native
rule has identical semantics.

Prettier stays last in the ESLint pass with the core and import-order fixers. Their
shared fix iterations must observe the final formatted line counts: a compact
function can pass a size limit and exceed it once formatted. Splitting those fixes
would require another convergence mechanism merely to move formatting between engines.

The React plugin consumes `settings['react-x']`, which still detects the installed
React version. Hooks consumes `settings['react-hooks']`, and the accessibility fork
consumes `settings['jsx-a11y-x']`. The unused legacy `settings.react.version = 'detect'`
is absent from the JS-plugin config because Oxlint validates that native setting as
a concrete version; ESLint retains its original settings.

Oxlint parses `.cjs` as CommonJS. Valid `require`/`module.exports` tooling remains
covered; ESM `export` syntax in a `.cjs` file is now rejected as invalid Node input.

`scripts/__tests__/oxlintPluginMigration.spec.ts` exercises real production Oxlint
diagnostics, explicit suppressions, compiler rules, formatting fixes, and retained
typed checks. `eslintWarnLevels.spec.ts` pins the combined warning scopes, and
`eslintConfig.spec.ts` runs the local AST fixtures through the same Oxlint config.
