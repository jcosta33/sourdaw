---
type: spec
id: SPEC-layout-components-migration
title: Migrate inline flex/grid layouts to the layout primitives
status: in-progress
owner: The Sourdaw team
sources:
  - self
---

# Migrate inline flex/grid layouts to the layout primitives

## Intent

Replace the inline `flex` / `grid` / `space-y` declarations scattered across the UI
with the `Stack` / `Row` / `Grid` / `Spacer` / `Divider` primitives
(`../layout-components/spec.md`), so layout intent is expressed through named
components without changing a single pixel of what users see.

## Non-goals

- Changing the primitive API — the migration consumes it as-is, inventing no props.
- Migrating complex grid templates, canvas/WebGL renderer surfaces, third-party
  component internals, dynamic conditional class construction, or responsive patterns.
- Automated rewrites — every substitution is a manual edit.

## Requirements

### AC-001 — Migrated surfaces render identically

When an inline layout is replaced by a primitive, the rendered surface must remain
visually identical (within AA subpixel tolerance) and preserve hover, focus,
keyboard, and scroll behavior.

Verify with: `manual` — A/B the migrated surface against its pre-migration state in Chromium

### AC-002 — Gap and direction semantics are preserved

A primitive substitution must preserve both the gap value and the flex direction;
an ambiguous inline class (`flex gap-2` with no `flex-col`) defaults to `Row` unless
surrounding context implies a column.

Verify with: `pnpm test:run -- DawControlStrip`

### AC-003 — Refs, data attributes, and handlers survive migration

When a migrated element carried a `ref`, `data-*` attribute, inline `style`, or event
handler, the primitive must forward it unchanged.

Verify with: `pnpm test:run -- layout`

### AC-004 — Migration introduces no architectural or type regressions

The migration must not introduce cross-module import violations or type errors.

Verify with: `pnpm deps:validate`

### AC-005 — High-traffic surfaces adopt the primitives

The control strip, dialog footer, metric cluster, and plugin metric strip must use
the layout primitives.

Verify with: `pnpm test:run -- daw`

### AC-006 — Out-of-scope patterns are left intact

Complex grid templates, renderer/canvas surfaces, and multi-condition class
constructions must remain unmigrated.

Verify with: `manual` — confirm migrated files still carry their `grid-cols-[...]` templates untouched

### AC-007 — Migrated code introduces no manual memoization or ref-forwarding

Migrated surfaces must not add `useMemo`, `useCallback`, `React.memo`, or `forwardRef`
(the codebase runs React 19 with the React Compiler).

Verify with: `pnpm lint <changed-files>`

### AC-008 — Migration introduces no layout-performance regression

A migrated surface must not introduce layout thrash or reflow regressions.

Verify with: `manual` — profile the migrated surface under load in Chromium DevTools and compare frame time against pre-migration baseline

### AC-009 — Migration introduces no frame-time regression under load

Frame time under load must not regress relative to a migrated surface's pre-migration state.

Verify with: `manual` — profile the migrated surface under load in Chromium DevTools and compare frame time against pre-migration baseline

## Open questions

- [ ] What coverage gates "done" — 50% of qualifying patterns, or the 80% target the
  primitive system was sized for? Blocks declaring the migration complete.
- [ ] (non-blocking) `space-x-*` patterns migrate to `Row gap`; confirm before sweeping
  them broadly.
- [ ] (non-blocking) Should semantic class names like `daw-control-strip` be kept on the
  migrated primitive (recommendation from sources: yes, carried via the `className` prop
  as a styling hook)? Confirm before stripping them.

## Affected areas

- `src/components/daw/` (control strip, dialog footer, metric cluster, plugin metric strip)
- `src/modules/**/presentations/` (panel and parameter layouts)
- `src/components/layout/` (consumed, not modified)

## Dropped from sources

- Codemods and bulk find-replace scripts — manual edits only, per the repo's
  no-automated-mutations rule.
- The migration search-regex helpers — a working aid, not a requirement.
- Migration-ordering decision: "Migrate by file group, not by class pattern, to
  amortize review cost and keep visual regressions local." A working method for the
  migration, not a verifiable requirement; recorded here so the ordering rationale
  is not lost.
- Risks table (from the original's "Tradeoffs and Risks"): Visual regression
  (mitigate by migrating one pattern at a time, verify in browser); Bundle size
  increase (components are tree-shakeable, minimal runtime); Breaking existing code
  (strict typing prevents invalid prop values); Migration fatigue (focus on
  high-impact Tier 1 patterns first); Mixed patterns during transition (mark with a
  `// TODO: migrate to Stack` comment). Recorded as project risk history; the
  substantive layout-divergence and spacing-scale concerns live in the layout-components
  spec and ACs above.
