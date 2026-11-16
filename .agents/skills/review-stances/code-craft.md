# Standing probes: code craft

A hunk lands a construct that a documented convention or a lint rule forbids, and nothing goes red: the
file sits on a burn-down baseline that silences the rule, the rule never existed for that convention, the
rule's own spec stopped observing it, or the diff quietly widens a baseline. Documented convention is a
contract, not a hedge, and a violation a lint rule already names is a merge blocker; personal style is not.
Every finding quotes the convention sentence or the lint message the head should have produced; hedged
findings without a concrete break ("I'd prefer if") are discarded.

## Standing probes

1. **A banned craft construct passes because its file is baselined.** The `sourdaw-craft` plugin
   (`scripts/oxlintCraft/plugin.mjs`) skips a rule for every path listed under that rule in
   `oxlint.craft-baseline.mjs`, so new code in a listed file is never linted for it. Input: grep each added
   hunk for `...(cond ? x : {})` or `...(cond && x)`, `{ ...x }` with no added field, `[...arr].map` and
   similar clone-then-method calls, `JSON.parse(JSON.stringify`, a chain of three or more
   `.map/.filter/.sort/.flatMap/.reduce`, and a ternary used as a statement. For each hit, look its file up
   under the matching rule id in `oxlint.craft-baseline.mjs` on the head. A listed file is the finding: no
   check goes red, so the reviewer is the check, citing the rule id and `docs/07-conventions.md`.
   `{ ...record, field }` and `fn(...args)` are legal.
2. **A craft construct in an unlisted file reaches a green Lint job.** Runs: CI; first establish the
   `Lint` job's actual checked merge ref, source and relevant rule configuration and severity. Input: any
   probe-1 construct in a file not listed for its rule. A checked tree containing both the added source
   and current enforcing configuration must report the plugin's message (for a conditional spread,
   "Do not spread a conditional or logical expression"). Only a green `Lint` on that combined tree
   means the rule does not match that syntactic form: name the form and carry it to probe 6 as a missing
   `invalid` row in `scripts/oxlintCraft/__tests__/plugin.spec.ts`.
3. **The diff widens a lint baseline instead of complying.** `oxlint.craft-baseline.mjs` and
   `eslint.size-baseline.mjs` only burn down: "No path is ever added". `craftBaseline.spec.ts` checks only
   rule keys, sort order, duplicates and existence, so a sorted, unique added path passes it. Input:
   `git diff <merge-base> <head> -- oxlint.craft-baseline.mjs eslint.size-baseline.mjs`. Any added path is
   the finding; a removed path whose file still violates the rule must turn the `Lint` job red on the head.
   Compare each changed file's actual integrated source with its recorded ceiling in
   `scripts/lintSizeCeilings.json`, and require `scripts/__tests__/lintSizeBaseline.spec.ts` to observe
   that combined version. #6618 and #6493 each grew the parser while a passing older checked tree
   omitted the parallel growth; the integrated source exceeded its unchanged ceiling. A passing
   older tree is no witness for the combined size. Extract a coherent responsibility to comply;
   never raise the ceiling or compress blank lines to hide growth.
4. **A `className` pile on a `ui/` primitive instead of a variant.** No lint rule observes this. Input: a
   call site that passes a run of layout or colour utilities (`className="h-8 px-3 …"`) to a primitive
   imported from `src/components/ui/`. The finding quotes `src/components/AGENTS.md` ("Do not pile Tailwind
   utilities onto `Button`, `Input`, or other `ui/` primitives at the call site") and names the CVA variant
   or wrapper the hunk should add. A single positional or state-driven class passed through the
   primitive's documented `className` escape is not a pile.
5. **Nesting that a guard would flatten.** Input, by mechanism: a nested ternary must turn the `Lint` job
   red through `no-nested-ternary` (error in `.oxlintrc.json`); a block nested five deep must turn it red
   through `max-depth` 4 in `eslint.config.mjs`, except in files listed in `eslint.size-baseline.mjs`, where
   the rule only warns and the reviewer is the check. A shallower nested `if` whose outer branch ends the
   function is a finding against `docs/07-conventions.md` ("Use guard clauses for early returns"): quote it
   and show the flattened guard. Do not invent style beyond those sentences.
6. **A craft rule its own spec no longer observes.** Replace one `sourdaw-craft` rule's visitor in
   `scripts/oxlintCraft/plugin.mjs` with `create() { return {}; }` and run
   `pnpm guard --profile focused -- pnpm test:run scripts/oxlintCraft/__tests__/plugin.spec.ts`. That
   rule's `invalid` rows must fail; remaining green means the spec no longer observes the rule.
   Apply the same paired-syntax probe to source censuses: a lexical `devices:` or
   `parameterValues:` match after `?` may be a conditional separator following a read, while a property
   inside the conditional is still a counted write. In
   `src/modules/Arrangement/stores/__tests__/deviceWriteBoundaryClosure.spec.ts`, require a read-only
   ternary negative, real property and updater-writer positives, and a full closure assertion. Remove
   the conditional-colon exclusion: the negative must fail. Bypass the real-property detector: the
   positive must fail. This guards the false-positive escape introduced by #2839's lexical census.
7. **Manual memoization in app code.** React Compiler owns memoization. Input: an added `useMemo`,
   `useCallback`, `React.memo` or `forwardRef` outside spec, mock and `__tests__` files. `useMemo`,
   `useCallback` and `React.memo` must turn the `Lint` job red through `sourdaw/no-manual-memoization`;
   that rule is off for test scaffolding, so a hit there is not a finding. `forwardRef` has no rule; the
   finding quotes the root `AGENTS.md` Architecture sentence forbidding it.
8. **Focused lint accepts its own configuration but does not enforce both engines.** PR #526's
   parity inventory covered five app/test scopes and omitted the configuration itself; #5300 exposed
   the focused target. Run `scripts/__tests__/eslintConfig.spec.ts` through the focused guard. A mutation
   that skips the ESLint leg or removes the configuration's required default-export exception must fail.
   Widening that exception to ordinary or nested modules must fail their default-export probes. Removing
   a typed helper or recursive traversal must fail the affected invalid custom-rule fixtures.
9. **Parallel source and rule promotion share no enforcing witness.** #6537 promoted
   `promise/always-return` to error while #6594's passing `Lint` checked an older merge tree where it
   still warned. Input: an unbaselined `.then(() => {})` must fail with `promise(always-return)` under
   the promoted error configuration. The same requirement covers helper arrows from #6593 and
   `const noExtraTargets = (): readonly string[] => [];` from #6616: unbaselined witnesses must fail
   `func-style` under #6537's promotion. The non-nullable store status fallback
   `status ?? { state: 'idle' }` from #6628 must fail `typescript/no-unnecessary-condition`, also
   promoted by #6537. Refs named `latestSend` or `focusIndexAfterReveal` without the `Ref` suffix
   (#6594) must fail `@eslint-react/naming-convention-ref-name` under #6540's promotion. #6594's
   checked tree preceded that promotion; #6540's enforcing checked tree omitted the Inspector source.
   The non-strict ruleset can admit independently green source and promotion heads (#6676).
   Before approving a rule promotion or baseline shrink, require current-integrated-tree CI `Lint`
   or an exact focused diagnostic for the relevant overlap; the checked tree must contain both the
   added source and current enforcing configuration. Refresh that witness when either relevant
   source or enforcing configuration changes. An older `--quiet` warning pass proves neither
   combined compliance nor a missing rule visitor.
10. **A lint pass that lints almost nothing stays green (PR #6610).** The full-tree public-plugin pass
    was handed shell globs through `spawnSync` with no shell, so oxlint linted one file in about a second
    while seven violations of error-level plugin rules merged behind it. PR #6610's review had no stance
    asking whether a moved lint step still observes its files. Input: plant a known violation of an
    error-level plugin rule in a file the step claims to cover and confirm that step's CI run goes red;
    compare the step's reported file count and duration with a directory run of the same config. A step
    whose count is a small fraction of the tracked sources must fail `scripts/__tests__/runLint.spec.ts`
    "fails a pass that linted far fewer files than its targets track".
