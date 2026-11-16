# Lint engine ownership

For checks, `scripts/runLint.ts` runs the existing native `.oxlintrc.json` pass, the native core rules and public JavaScript
plugins in `.oxlint-plugins.json`, then the retained `eslint.config.mjs` pass. The plugin
and final ESLint passes retain the previous ESLint targets and ignore set, with
`scripts/lint/sourdaw.mjs` explicitly added to their full targets. The native pass
excludes some JavaScript tooling and existing TypeScript debt that still needs these checks.
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
without enabling moved rules in check mode, so the split passes accept each other's suppressions.
It also retains the historical `react-hooks/`, `promise/`, and `jsx-a11y-x/` plugin
registrations so directives naming inactive rules remain valid. Those registrations
enable only the three bulk-owned hook rules (`exhaustive-deps`, `refs`, and
`set-state-in-effect`) under their original `react-hooks/` names. The other moved
hook rules use `react-hooks-js/`. Unknown rule names still fail directive validation.
Unused-disable reporting remains off because neither pass observes all rules.

ESLint also owns the promoted React rules `exhaustive-deps`,
`naming-convention-context-name`, `naming-convention-ref-name`, `no-array-index-key`,
`set-state-in-effect`, and `use-state`, plus the three bulk-owned hook rules above.
Their existing per-file violation budgets stay in `eslint-suppressions.json`.
The runner names that file with `--suppressions-location` for both checks and fixes;
extra violations fail, and unused counts fail until explicitly pruned. This includes
`no-void` and `no-restricted-syntax`, alongside the React and Hooks rules. Oxlint has
counted suppression machinery, but its `--fix` path automatically prunes stale counts,
and a missing implicit `oxlint-suppressions.json` does not fail a clean run. Its
suppression-generation and pruning switches are hidden from the public CLI help.
Those contracts cannot replace the required file and explicit-prune-only behavior here;
budgeted rules stay in ESLint and must not run twice. The committed counts only shrink.

ESLint remains necessary for `@eslint-react/no-leaked-conditional-rendering`,
`@tanstack/query/no-void-query-fn`, `@tanstack/query/no-rest-destructuring`, and
`@typescript-eslint/naming-convention`: their existing behavior needs TypeScript
parser services that Oxlint's public JS-plugin API does not supply. Native tsgolint
does not expose its type checker to JS plugins. The recommended eslint-comments
rules also stay in ESLint: their blanket-directive diagnostics deliberately use
column `-1`, which Oxlint rejects as an out-of-range location. `import-x/order` retains its ordered
TypeScript and Node resolver functions. Core rules retain their ESLint implementations
for the remaining gaps. Native `id-length` rejects a lowercase one-character TypeScript
type alias that ESLint's core rule accepts. Native `typescript/consistent-return` exempts
void-valued returns that the configured core rule treats as value returns, even with
type-aware checking enabled. Native `no-invalid-this`, `no-octal`, and the configured
selector-based `no-restricted-syntax` have no equivalent in the installed rule schema.
The configured naming rule is syntactic (PascalCase type parameters of at least two
characters), but the unchanged plugin still requires parser node maps; it is not moved
through a locally rewritten compatibility rule.

`preserve-caught-error`, `no-useless-computed-key`, and the size/depth/complexity
ceilings use stock native implementations in `.oxlint-plugins.json`. That pass has the
full previous ESLint scopes, including tooling and debt excluded from `.oxlintrc.json`.
The core IDs remain valid in inline directives. TypeScript-only ceilings, test and E2E
exemptions, and every size warning path retain their original ordering and severity.
The literal native warning paths mirror `eslint.size-baseline.mjs`; the integration
spec asserts exact equality, so editing the canonical burn-down list requires updating
the native config in the same change. Warning overrides repeat the complete option tuples:
Oxlint resets severity-only overrides to rule defaults. Preserve the 600/100/4/20 ceilings,
blank-line and comment skipping, and IIFE checks alongside warning severity. Warnings
continue to report instead of being disabled.

For `--fix`, the native Oxlint pass runs first, then ESLint owns all remaining fixes
in one existing fix loop. The runner explicitly selects this mode before loading
ESLint's config; checks clear inherited fix intent and use a separate content cache.
ESLint reads the canonical moved rules, settings, and ordered filename overrides
from `.oxlint-plugins.json`, retaining its parser and type-checking exclusions.
The moved native core rules are also projected into that fix loop; their check ownership
remains Oxlint. Prettier stays last alongside core, import-order, and public-plugin fixers. Formatting
can move a nested diagnostic beyond a next-line suppression, expose a comment that
needs another fix, or expand a compact function beyond its size limit. The shared
loop fixes exposed comments and reports remaining violations on the final text.
After that loop succeeds, the public-plugin Oxlint pass checks the final bytes without
fixing them. This preserves its CommonJS parser and missing/unsupported-target
admission contracts while ESLint remains the last writer.

The React plugin consumes `settings['react-x']`, which still detects the installed
React version. Hooks consumes `settings['react-hooks']`, and the accessibility fork
consumes `settings['jsx-a11y-x']`. The unused legacy `settings.react.version = 'detect'`
is absent from the JS-plugin config because Oxlint validates that native setting as
a concrete version; ESLint retains its original settings.

Oxlint parses `.cjs` as CommonJS. Valid `require`/`module.exports` tooling remains
covered; ESM `export` syntax in a `.cjs` file is now rejected as invalid Node input.

`scripts/__tests__/oxlintPluginMigration.spec.ts` owns all real lint processes and
workspace fixtures, including local AST diagnostics, explicit suppressions, compiler
rules, formatting fixes, warning-gate probes, retained typed checks, frozen core-rule parity controls, native candidate gaps, and
warning-baseline parity. Its cases run
sequentially: a native TypeScript program must not discover another worker's fixture
just before that worker deletes it. The config and warning specs keep read-only
metadata checks and the original parser's in-memory compatibility cases.
Typed fixture probes reset the public TypeScript parser caches after creating a new
file, so CI's single-run program snapshot includes that file without widening its project.
