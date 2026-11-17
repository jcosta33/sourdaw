# Lint engine ownership

For checks, `scripts/runLint.ts` runs the existing native `.oxlintrc.json` pass, the native core rules and public JavaScript
plugins in `.oxlint-plugins.json`, then the retained `eslint.config.mjs` pass and the
read-only quality pass in `.oxlint-quality.json`. The plugin
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
`react-hooks-js/`, `promise-js/`, `jsx-a11y-x-js/`, and `import-x-js/` in configurations and inline disable
comments. The remaining plugin names stay unchanged. ESLint registers these names
without enabling moved rules in check mode, so the split passes accept each other's suppressions.
It also retains the historical `react-hooks/`, `promise/`, `jsx-a11y-x/`, and `import-x/` plugin
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
Those contracts cannot replace the required file and explicit-prune-only behavior for the
rules retained in ESLint. The committed ESLint counts only shrink.

The quality pass uses Oxlint's public JSON diagnostics on the checked files, including the
final bytes after cofix. `oxlint-quality-baseline.json` holds counts by path and rule. Extra
diagnostics fail the check. When the count drops, reduce or remove the entry in the same
change. Both check and fix require the ledger and leave its bytes alone. The PR static
check refuses new entries and raised counts against the merge base. Delivery checks for
source and ledger changes that cross on `main` and the pull request. The historical counts
record existing syntactic matches, which can include intentional handling of cleanup or
observational failures. An intentional new instance whose full contract the rule cannot
observe can use a reasoned `oxlint-disable-next-line` naming that rule.

The native Oxlint suppression file is implicit for every invocation, including other
passes and the initial `--fix`. Oxlint 1.93 prunes entries for rules that a pass did not
run on a linted file, so using that shared file would erase another pass's ledger.
The runner refuses an implicit `oxlint-suppressions.json` before starting. The quality
pass neither uses hidden suppression flags nor introduces another fixer.

The failure rules flag empty catches and direct success objects from handlers that do no
recovery. A boolean value by itself cannot distinguish success from a conservative
predicate or policy. The boundary rule follows direct JSON parsing, a response with
local `fetch` or `Response` provenance, and the imported desktop bridge. Assigning the
result to `unknown` keeps the validation step explicit. Playwright admission checks
locally visible guards that would let the case finish without an assertion. Fixed test
sleeps include Playwright's timeout, directly awaited timer promises and test helpers that
return only a delay. Tests that
measure a real observation window can use a line-scoped reason for the duration.

The stock Vitest conditional-expect rule runs only on Vitest specs. The local assertion
rule checks imported Vitest `expect`, including aliases, `soft`, and `poll`, and leaves
Chai getter assertions and static asymmetric matchers available. Oxlint 1.93 and the
[public Vitest ESLint rule](https://github.com/vitest-dev/eslint-plugin-vitest/blob/main/src/rules/valid-expect.ts)
report a raw async matcher promise assigned to a variable even when the test awaits the
same binding after advancing fake timers. The local rule verifies direct await or return,
or an immutable local binding observed later in the same block, including `Promise.all`.
A conditional await or rejection handler that can conceal failure cannot establish that
proof. Complex promise control flow still requires review.

ESLint remains necessary for `@eslint-react/no-leaked-conditional-rendering`,
`@tanstack/query/no-void-query-fn`, `@tanstack/query/no-rest-destructuring`, and
`@typescript-eslint/naming-convention`: their existing behavior needs TypeScript
parser services that Oxlint's public JS-plugin API does not supply. Native tsgolint
does not expose its type checker to JS plugins. The recommended eslint-comments
rules also stay in ESLint: their blanket-directive diagnostics deliberately use
column `-1`, which Oxlint rejects as an out-of-range location.
Import ordering uses the unchanged public plugin under its supported `import-x-js/order`
alias. Its JSON resolver chain tries TypeScript before Node with `preserveSymlinks: false`,
preserving the former resolver factories' symlink behavior. The canonical settings and
six-extension scope live in `.oxlint-plugins.json` and feed ESLint's shared cofix loop.
No resolver-next setting remains to shadow that chain. Frozen resolver-factory probes
compare diagnostics, grouping, final bytes, and idempotence against the JSON configuration,
including resolved/unknown aliases and a discriminating Node fallback.

Import suppressions must name `import-x-js/order`; historical `import-x/order` directives
remain valid known-rule comments but do not suppress the new canonical ID. A rule-ID
migration must update actual directives and ledger entries together with its configuration.
The controlled compatibility probes deliberately show both IDs' behavior rather than
treating the alias as an upstream API failure. Core rules retain their ESLint implementations
for the remaining gaps. Native `id-length` rejects a lowercase one-character TypeScript
type alias that ESLint's core rule accepts. Native `typescript/consistent-return` exempts
void-valued returns that the configured core rule treats as value returns, even with
type-aware checking enabled. Native `no-invalid-this` and the configured
selector-based `no-restricted-syntax` have no equivalent in the installed rule schema.
The redundant `no-octal` rule is omitted: the configured module parser rejects legacy
numeric octals before rules run for every extension in its former glob
(`js`, `jsx`, `ts`, `tsx`, `mts`, `cts`), while accepting modern `0o` literals.
The integration proof uses that production parser and a fixture-owned type-aware
project admitting all six extensions; project-membership errors do not count as syntax proof.
String octal escapes are a separate parser restriction. Neither `mjs` nor `cjs` was in the rule's glob.
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

Stock `eslint-plugin-prettier` works through Oxlint's public plugin API and produces
the same stable formatting on an independent formatting fixture. That support alone
does not replace the shared loop. For a compact function whose next-line directive
suppresses `no-useless-computed-key`, the stock combined native/Prettier fix invocation
returns success after formatting moves `return { ['key']: 1 };` beyond the directive.
A fresh check then rejects that computed key. A second fix invocation removes the
brackets, leaving `return { 'key': 1 };`, and a fresh check rejects its Prettier quote
formatting. The native fixer exists, but the invocation does not converge on final
bytes. The existing ESLint loop produces `return { key: 1 };` in one invocation and
passes the subsequent check. The maintained isolated CLI probes preserve these exact
counterexamples without adding an adapter or another production fix loop.

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
