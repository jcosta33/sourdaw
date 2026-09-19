# Lesson library: code craft

Lesson library for code-craft defects: documented convention is a contract, not a hedge. A
documented convention violation that a lint rule already names is a merge blocker. Personal style
is not. Per the Review section of `AGENTS.md`, this directory is a lesson library, not a stance
menu: an escape — a defect that reached `main` whose defect class matches this file — is recorded
here as a lesson, and every dispatch whose derived stance matches this file carries its lessons.
Lessons state the escape, the blind spot, and the probe that would have caught it. Keep each
lesson short enough to paste into a dispatch.

This file's defect class covers diffs that add or edit TypeScript or JavaScript (especially
`src/**/presentations/**`, `src/components/**`, and `scripts/`), or that touch lint config,
`docs/07-conventions.md`, or this file. Skip pure Rust/DSP-only diffs unless they also change TS.

## Standing probes

- Read `docs/07-conventions.md` and the lint rule the hunk should have hit. A new
  `...(cond ? x : {})`, `{ ...x }`, `[...arr].map`, `JSON.parse(JSON.stringify`, three-or-more
  `.map/.filter/.sort/.flatMap/.reduce` chain, or a ternary used as `if` is a finding if the file
  is not on that rule's list in `oxlint.craft-baseline.mjs`. `{ ...record, field }` and
  `fn(...args)` are legal.
- A call site that dumps a long `className` pile onto a `src/components/ui/` primitive instead of a
  CVA variant is a finding against `src/components/AGENTS.md` and `.agents/skills/ui-patterns`.
- Nested `if` that a guard/early-return would flatten, and nested ternaries (`no-nested-ternary` is
  already error): name the construct and the convention sentence it breaks. Do not invent style.
- Hedged findings without a concrete break ("I'd prefer if") are discarded. Quote the convention or
  the lint message the head should have produced.
- Mechanical probe for this stance's own gates: revert one `sourdaw-craft` rule's visitor to
  `create() { return {}; }` and run `pnpm test:run scripts/oxlintCraft/__tests__/plugin.spec.ts`.
  Remaining green fails test-validity — the spec no longer observes that rule.

## Lessons from escapes

None yet.
