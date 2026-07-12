---
type: audit
id: AUDIT-layout-components
title: Flex/grid layout patterns and primitives
status: open
owner: The Sourdaw team
sources:
  - src/components/daw/
  - src/components/ui/
  - src/components/layout/
  - src/modules/*/presentations/
  - src/helpers/Styles/cn.ts
---

# Audit: Flex/grid layout patterns and primitives

Present state of Tailwind flexbox and grid usage across the DAW UI, and of the
layout primitives that already encapsulate some of those patterns. Recorded to
inform a spec for standardized layout components (`Stack`, `Row`, `Grid`, …).

## Scope

- In scope: Tailwind flex/grid layout classes across `src/**/*.tsx`, the
  layout-like DAW components that wrap them (`src/components/daw/`), and the
  layout primitives at `src/components/layout/`.
- Out of scope: one-off utility classes for specific visual effects, Canvas/WebGL
  renderer surfaces (they own their own pixels), and third-party component
  library internals.

## Observations

- Layout primitives already exist: `src/components/layout/` ships `Stack.tsx`,
  `Row.tsx`, `Grid.tsx`, `Spacer.tsx`, `Divider.tsx` with a barrel `index.ts` and
  `__tests__/` — evidence: `src/components/layout/` (verified 2026-06-12).
- Vertical stacking dominates: `flex-col` appears far more often than explicit
  `flex-row` (~391 vs ~5) — evidence: `rg flex-col`/`rg flex-row` over
  `src/**/*.tsx` (approximate counts, snapshot 2026-04-14; re-run before reuse).
- 8px gap (`gap-2`, ~363) and 4px gap (`gap-1`, ~351) are the most common spacing
  values, consistent with a dense DAW UI — evidence: `rg gap-` over
  `src/**/*.tsx` (snapshot 2026-04-14; re-run before reuse).
- `items-center` accounts for the overwhelming majority of cross-axis alignment
  (~657 vs ~45 `items-start`, ~29 `items-end`) — evidence: `rg items-` over
  `src/**/*.tsx` (snapshot 2026-04-14; re-run before reuse).
- The legacy `space-y-*` spacing pattern is still present alongside `gap-*`:
  ~95 `.tsx` files still use `space-y-*` (re-verified 2026-06-12) — evidence:
  `EnvelopeSection.tsx:58`, plus `rg space-y- src/**/*.tsx`.
- Grid usage is concentrated in form/parameter layouts: `grid-cols-2` (~59) and
  `grid-cols-3` (~23) dominate; higher column counts are rare — evidence:
  `rg grid-cols- src/**/*.tsx` (snapshot 2026-04-14; re-run before reuse).
- Complex CSS grid templates (`grid-cols-[15rem_minmax(0,1fr)_16rem]`, etc.,
  ~23 occurrences) are used for high-level three-column panel architecture, not
  parameter grids — evidence: `GlutenPanel.tsx:342`, `AppShell.tsx`.
- `shrink-0` (~225) and `min-h-0` recur as required guards: `shrink-0` protects
  fixed-width controls (knobs, buttons) from compression and `min-h-0` keeps
  scrollable flex children from overflowing — evidence: `rg shrink-0`/`rg min-h-0`
  over `src/**/*.tsx` (snapshot 2026-04-14; re-run before reuse).
- Several DAW components already wrap recurring layout patterns: e.g.
  `DawPanelSurface` (`flex flex-col` + tone variants), `DawControlStrip`
  (`flex items-center gap-2`), `DawDialogBody` (`flex flex-col gap-4`),
  `DawPluginRail` (`flex flex-col gap-3` scrollable) — evidence:
  `src/components/daw/DawPanelSurface.tsx`, `DawControlStrip.tsx`,
  `DawDialogBody.tsx`, `DawPluginRail.tsx`.
- Two further DAW components wrap layout patterns beyond the four above:
  `DawUtilitySection` provides a section with a header/body layout, and
  `DawPluginSectionCard` is a `flex flex-col gap-3` card — evidence:
  `src/components/daw/DawUtilitySection.tsx`,
  `src/components/daw/DawPluginSectionCard.tsx`. Two more round out the set:
  `DawMetricCluster` (`flex items-center gap-1`) and `DawPluginMetricStrip`
  (`flex flex-wrap` with alignment) — evidence:
  `src/components/daw/DawMetricCluster.tsx`,
  `src/components/daw/DawPluginMetricStrip.tsx`.
- The app-shell root is itself a hand-authored flex column that owns the
  top-level page frame — evidence: `src/components/daw/AppShell.tsx` (named as
  evidence at `audit.md:52` for the complex-template observation). Its layout is
  the shell wrapper around `TransportBar`, the main content region, and
  `StatusBar`:

  ```tsx
  <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-app">
      <TransportBar />
      <div className="flex flex-1 overflow-hidden">
          {/* Left panels */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">{/* Main content */}</div>
          {/* Right panels */}
      </div>
      <StatusBar />
  </div>
  ```

- Granular per-row counts from the prior audit's pattern tables (snapshot
  2026-04-14; re-run before reuse): rarer flex/gap rows — `gap-6` (~8),
  `gap-x-2` (~16), `gap-y-3` (~14), `flex-wrap` (~122), `flex-1` / `flex-[n]`
  (~222); legacy `space-y-*` breakdown — `space-y-1` (~67), `space-y-2` (~50),
  `space-y-3` (~34); rarer grid columns — `grid-cols-4` (~15), `grid-cols-1`
  (~12), `grid-cols-5` (~4), `grid-cols-8` (~1) — evidence: `rg gap-`/`rg flex-`/
  `rg space-y-`/`rg grid-cols-` over `src/**/*.tsx`.
- Gap values vary across structurally similar layouts, so visually equivalent
  sections do not share a spacing scale — evidence: `GenericDeviceLayout.tsx`,
  `GlutenPanel.tsx`, `FermenterPanel.tsx`.

## Risks

- Two ways to express the same layout (raw `flex …`/`grid-cols-*` classes vs the
  `src/components/layout/` primitives) coexist — fires when: a developer reads one
  area for a pattern and copies the raw-class form into new code, deepening the
  divergence the primitives were meant to close.
- No spacing scale is enforced, only conventional — fires when: ad-hoc gap values
  accumulate and a later design-system pass has to reconcile inconsistent spacing
  across panels.
- The `space-y-*` / `gap-*` mix produces inconsistent spacing behavior — fires
  when: a `space-y-*` container gains a flex `gap` (or vice versa) and the two
  spacing models compound or fight.
- A broad migration touches a very large surface (~1,164 `flex` occurrences in the
  2026-04-14 snapshot) — fires when: call sites are migrated en masse without a
  priority order, risking layout regressions across unrelated panels.
- Bundle size could grow as new layout components are added without
  tree-shaking — fires when: the `src/components/layout/` barrel pulls every
  primitive into a bundle even where only one is used, so the shared spacing
  system costs more bytes than the inline classes it replaces — evidence:
  `src/components/layout/index.ts` (the prior audit flagged this as Risks #2).

## Open questions / unverified areas

- Pattern counts are an approximate `rg`-style snapshot from 2026-04-14
  (re-confirmed only for `space-y-*` ~95 files on 2026-06-12) — why not:
  not re-counted live this pass; treat every count as stale until re-run.
- Whether the complex three-column `grid-cols-[…]` templates should remain
  hand-authored or be expressible through a primitive — they read as intentional
  panel architecture rather than a repeated pattern.
- Whether the existing `src/components/daw/` layout-like components should be
  retired in favor of the `src/components/layout/` primitives or kept as
  domain-specific wrappers on top of them.

## Candidate requirements

<!-- Prose only; AC numbering and Verify-with lines belong to the spec. -->

- A spec should define the contract of the core layout primitives (`Stack`,
  `Row`, `Grid`) — their props, the allowed gap scale, and how children opt into
  `flex-1` / `shrink-0` behavior — since the components already exist but their
  API and the spacing scale they enforce are not pinned down.
- A spec should decide whether gap values are restricted to a fixed design-system
  scale or allow arbitrary values, and whether the primitives support `as`
  polymorphism like `DawPanelSurface`.
- A spec should set a migration policy for the legacy `space-y-*` pattern (~95
  files) and for the inline `flex …` / `grid-cols-*` call sites, including a
  priority order so the large surface is migrated safely rather than en masse.
- A spec should record the complex three-column `grid-cols-[…]` panel templates
  as intentional, non-abstracted layout so future cleanup passes do not try to
  fold them into a primitive.
