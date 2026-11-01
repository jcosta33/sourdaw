# Standing probes: code craft

Defects where a hunk breaks a documented convention: documented convention is a contract, not a hedge, and a
violation a lint rule already names is a merge blocker; personal style is not. Stances in this class typically arise
on diffs that add or edit TypeScript or JavaScript (especially `src/**/presentations/**`, `src/components/**` and
`scripts/`) or touch lint config, `docs/07-conventions.md` or this file; pure Rust/DSP diffs rarely admit one unless
they also change TS. Every finding quotes the convention sentence or the lint message the head should have produced;
hedged findings without a concrete break ("I'd prefer if") are discarded.

## Standing probes

1. **A banned construct outside the rule's baseline.** Read `docs/07-conventions.md` and the lint rule the hunk
   should have hit. A new `...(cond ? x : {})`, `{ ...x }`, `[...arr].map`, `JSON.parse(JSON.stringify`, three-or-more
   `.map/.filter/.sort/.flatMap/.reduce` chain, or a ternary used as `if` is a finding if the file is not on that
   rule's list in `oxlint.craft-baseline.mjs`. `{ ...record, field }` and `fn(...args)` are legal.
2. **A `className` pile instead of a variant.** A call site that dumps a long `className` pile onto a
   `src/components/ui/` primitive instead of a CVA variant is a finding against `src/components/AGENTS.md` and
   `.agents/skills/ui-patterns`.
3. **Nesting a guard would flatten.** A nested `if` that a guard or early return would flatten, and nested ternaries
   (`no-nested-ternary` is already error): name the construct and the convention sentence it breaks. Do not invent
   style.
4. **A craft rule its own spec no longer observes.** Revert one `sourdaw-craft` rule's visitor to
   `create() { return {}; }` and run `pnpm test:run scripts/oxlintCraft/__tests__/plugin.spec.ts`. Remaining green
   fails test validity: the spec no longer observes that rule.

## Scope

This file stays separate below the five-probe floor: no other stance class contains documented-convention
violations, and padding it would invent probes. Record an escape here as a probe when one reaches `main`.
