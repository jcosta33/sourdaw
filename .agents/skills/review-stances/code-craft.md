# Standing probes: code craft

A hunk lands a construct that a documented convention or a lint rule forbids, and nothing goes red: the
file meets its rule's recorded count, the rule never existed for that convention, or the rule's own
spec stopped observing it. Documented convention is a
contract, not a hedge, and a violation a lint rule already names is a merge blocker; personal style is not.
Every finding quotes the convention sentence or the lint message the head should have produced; hedged
findings without a concrete break ("I'd prefer if") are discarded.

## Standing probes

1. **One violation is traded for another under the same count.** Compare the added source with
   `oxlint-quality-baseline.json` for its file and rule. The count rejects growth but preserves an
   unchanged total, even when a different violation replaced a removed one. Identify the added
   occurrence and quote its rule message. For spread rules, keep `{ ...record, field }` and
   `fn(...args)` as controls.
2. **A craft construct on a path with no count reaches a green Lint job.** Establish the checked
   merge ref, source, quality configuration and severity. The same checked tree containing a new
   conditional spread with no allowance must report "Do not spread a conditional or logical
   expression". If the integrated run is green, reduce the missed syntax to an invalid row in
   `scripts/oxlintCraft/__tests__/plugin.spec.ts`.
3. **Concurrent changes exceed a size ceiling that neither side exceeded alone.** Compare the actual
   integrated source with `scripts/lintSizeCeilings.json`. #6618 and #6493 independently grew the
   parser against older trees and the combined source exceeded its unchanged ceiling. Require the
   current combined witness. Extract a coherent responsibility to comply.
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
   Mirrored warning paths also need the integrated canonical set: #6740 retained a migrated warning entry
   after #6825 removed its source and canonical baseline entry. A deleted path must leave every mirror,
   preserving all surviving paths, severities and ceilings. Require the exact warning-set and canonical
   burn-down cases in `scripts/__tests__/eslintWarnLevels.spec.ts` and
   `scripts/__tests__/oxlintPluginMigration.spec.ts`; restoring the obsolete mirrored path must fail both.
10. **A lint pass that lints almost nothing stays green (PR #6610).** The full-tree public-plugin pass
    was handed shell globs through `spawnSync` with no shell, so oxlint linted one file in about a second
    while seven violations of error-level plugin rules merged behind it. PR #6610's review had no stance
    asking whether a moved lint step still observes its files. Input: plant a known violation of an
    error-level plugin rule in a file the step claims to cover and confirm that step's CI run goes red;
    compare the step's reported file count and duration with a directory run of the same config. A step
    that lints even one file fewer than the tracked, non-ignored sources under its targets must fail
    `scripts/__tests__/runLint.spec.ts` "fails a pass one file short, however large the tree", and
    deleting the coverage assertion from the full run must fail "fails a plugin pass that lints fewer
    files than the targets track, before ESLint runs".
11. **Formatting changes the type behavior of a lint autofix (PR #7033).** The ternary
    fixer grouped statement calls. Prettier removed the grouping and TypeScript
    treated the calls as assertions. Probe a ternary whose branches call a declared
    assertion and whose function subsequently returns the asserted value. Compare the
    inferred declaration before the fix and after formatting. Also use a locally
    inferred assertion callee, which produces TS2775 if formatted as a bare call,
    and a computed member or immediately invoked function, which can produce TS2776.
    Require eligible fixtures to retain their types and runtime effects after the
    documented formatting step.

## Retired lessons

- #4186 skipped the entire craft rule for any listed file. `scripts/__tests__/lintQualityBudget.spec.ts`
  checks equal, excess, unrecorded and stale counts. `scripts/__tests__/runLint.spec.ts` exercises
  the same enforcement after the last writer in check and fix, with the ledger bytes intact.
- The old craft inventory test let a sorted, unique file be added without a finding.
  `scripts/__tests__/lintSizeBaseline.spec.ts` checks merge-base admission and refuses a raised count.
  `scripts/__tests__/lintLedgerCrossing.spec.ts` covers overlapping count and source edits at delivery.
