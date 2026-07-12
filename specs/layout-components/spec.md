---
type: spec
id: SPEC-layout-components
title: Layout primitives (Stack, Row, Grid, Spacer, Divider)
status: done
owner: The Sourdaw team
sources:
  - self
---

# Layout primitives (Stack, Row, Grid, Spacer, Divider)

## Intent

Provide a small set of type-safe layout components that enforce the design-system
spacing scale, so UI authors compose layouts from named primitives instead of
re-deriving the same inline flex/grid class combinations by hand.

## Non-goals

- Migrating existing inline layouts to these primitives — that is a separate effort.
- Complex grid templates (e.g. `grid-cols-[15rem_minmax(0,1fr)_16rem]` three-column
  panels, `grid-cols-[minmax(0,1fr)_260px]` main + sidebar,
  `grid-cols-[minmax(0,1fr)_3.75rem]` content + meter): panel architecture keeps
  inline classes.
- Responsive breakpoint variants — the DAW is desktop-only.
- Layout animation primitives.

## Requirements

### AC-001 — Stack stacks vertically with a token gap

When `Stack` renders with a gap token, it must apply a column flex container
(`flex flex-col min-h-0`) plus the matching `gap-*` class for that token.

Verify with: `pnpm test:run -- Stack`

### AC-013 — Stack defaults to stretch alignment and emits align/justify classes

`Stack` must default its `align` prop to `stretch` (so children fill the cross
axis full-width by default), and must emit the matching `items-*` / `justify-*`
class for any `align` (`start | center | end | stretch`) or `justify`
(`start | center | end | between`) prop value.

Verify with: `pnpm test:run -- Stack`

### AC-002 — Row arranges horizontally, centered by default

When `Row` renders, it must apply a row flex container with `items-center` and the
matching gap class unless `align`/`justify` props override the defaults.

Verify with: `pnpm test:run -- Row`

### AC-003 — Grid lays out typed columns

When `Grid` renders with `cols` and gap tokens, it must apply a grid container with
the matching `grid-cols-*` and gap classes.

Verify with: `pnpm test:run -- Grid`

### AC-004 — Spacer produces fixed-size spacing

When `Spacer` renders with a size token and axis, it must produce a fixed-dimension
element on the chosen axis.

Verify with: `pnpm test:run -- Spacer`

### AC-005 — Divider renders a separator with tone and spacing

When `Divider` renders, it must produce a separator line honoring its `axis`,
`tone`, and `spacing` props.

Verify with: `pnpm test:run -- Divider`

### AC-006 — The spacing scale is enforced at the type level

A gap or size prop must accept only the design-system spacing tokens
(`0 | 1 | 2 | 3 | 4 | 6 | 8`), and a cols prop only its allowed column counts; any
other value (e.g. `gap={5}`, `gap="12px"`) must be a TypeScript compile error.

Verify with: `manual` — assign `gap={5}` in a scratch usage and confirm the build reports a type error

### AC-007 — Primitives forward ref and native attributes

Each primitive must accept `ref` as a regular prop (React 19) and pass through the
native HTML attributes of its `as` element.

Verify with: `pnpm test:run -- layout`

### AC-008 — Grid supports independent axis gaps and flow direction

`Grid` must accept `gapX` and `gapY` props that set the horizontal and vertical
grid gap independently (emitting `gap-x-*` / `gap-y-*`), and a `flow: 'row' | 'col'`
prop that sets the grid auto-flow direction (emitting `grid-flow-row` /
`grid-flow-col`).

Verify with: `pnpm test:run -- Grid`

### AC-009 — Row exposes the full alignment enum

`Row`'s `align` prop must accept `baseline` (emitting `items-baseline`) in addition
to `start`/`center`/`end`/`stretch`.

Verify with: `pnpm test:run -- Row`

### AC-010 — Stack and Row expose grow, shrink, and wrap modifiers

`Stack` and `Row` must each accept `grow` (emits `flex-1`), `shrink` (emits
`shrink-0` when `false`), and `wrap` (emits `flex-wrap`) as typed boolean props
with the defined class output.

Verify with: `pnpm test:run -- layout`

### AC-011 — Primitives cover 80%+ of audited layout patterns

The `Stack`/`Row`/`Grid` primitives must cover at least 80% of the layout patterns
catalogued in the audit, demonstrated by worked migration examples that map each
common audited pattern to its primitive form.

Verify with: `manual` — walk the migration-examples mapping in `specs/layout-components/audit.md` and confirm each common audited pattern (`flex flex-col gap-*`, `flex items-center gap-*`, `grid grid-cols-* gap-*`, `space-y-*`) resolves to a primitive

### AC-012 — Row exposes the full justification enum

`Row`'s `justify` prop must accept `around` and `evenly` (emitting
`justify-around` / `justify-evenly`) in addition to `start`/`center`/`end`/`between`.

Verify with: `pnpm test:run -- Row`

### AC-014 — Primitives live one-per-file and merge classes via the shared cn helper

Each primitive must live in its own single file under `src/components/layout/`
(following the `src/components/daw/` convention) and merge its computed classes
with caller-supplied `className` through the shared `cn` helper
(`#/utils/Styles/cn`), so callers can always extend a primitive with extra classes.

Verify with: `pnpm test:run -- layout` (each primitive merges a passed `className`)

## Open questions

- [ ] (non-blocking) An `Inline` primitive for wrap-heavy layouts — deferred until
  a real need appears; `Row wrap` covers the current cases.
- [ ] (restored detail) Should primitives be exported individually or required to be
  imported via a barrel (`import { Stack } from '#/components/layout'`)? Recommendation
  from the source spec: barrel export, for consistency with other component folders.

## Known risks

Present-state findings from the layout audit (`specs/layout-components/audit.md`).
Counts are approximate `rg`-snapshot figures from 2026-04-14 — re-run before relying
on any number.

- Spacing scale, by frequency (`src/**/*.tsx`): `gap-2` ~363 (most popular), `gap-1`
  ~351, `gap-3` ~170 (third-most-common, "section spacing"), `gap-4` ~38 ("larger
  sections"), `gap-6` ~8 — the `0|1|2|3|4|6|8` token set the primitives accept matches
  this observed distribution.
- Main-axis justification, by frequency: `justify-center` ~164, `justify-between`
  ~129, `justify-start` ~17, `justify-end` ~17 — the enums on `Row`/`Stack` cover all
  four.
- Most common class co-occurrences the primitives are meant to absorb: `flex
  items-center gap-2` ~222 (Row), `flex flex-col gap-3` ~104 (Stack), plus `flex
  items-center justify-between`, `flex items-center justify-center`, `grid grid-cols-2
  gap-2`, `flex flex-col items-center gap-1`, and `flex min-h-0 flex-col gap-3`.
- Scale of the surface the primitives sit alongside: `src/components/daw/*.tsx`
  carries 60+ DAW-specific UI primitives that already encapsulate these flex/grid
  patterns inline; the new layout primitives follow the same authoring conventions
  (shared `cn` helper, native-HTML-attribute extension, `ref` support) so the two
  families stay consistent during the still-incomplete migration.

## Affected areas

- `src/components/layout/Stack.tsx`, `Row.tsx`, `Grid.tsx`, `Spacer.tsx`, `Divider.tsx`
- `src/components/layout/index.ts`
- `src/components/layout/__tests__/`

## Dropped from sources

- Responsive breakpoint props (`gapMd`, `colsMd`) — the DAW is desktop-only and the
  layout audit found negligible responsive usage.
- A `colSpan` helper prop on `Grid` children — children use the standard
  `className="col-span-*"` instead.
- Layout-animation primitives — out of scope for a spacing system.
- The "Developer resistance" risk from the original spec (some developers may
  prefer inline classes; mitigation: document the benefits and enforce adoption
  via code review) — dropped as a social/process risk rather than a verifiable
  component requirement; the audit keeps the technical migration risk (the
  ~1,164-`flex` surface) instead.
