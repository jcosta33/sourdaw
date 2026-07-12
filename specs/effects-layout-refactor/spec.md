---
type: spec
id: SPEC-effects-layout-refactor
title: Unified effects browser tab
status: done
owner: The Sourdaw team
sources:
  - self
---

# Unified effects browser tab

## Intent

Present every audio effect — Faust, Web Audio, and premium — under a single Effects tab
organized by semantic function (EQ & Filter, Dynamics, Time & Space), so users find a plugin
by what it does rather than by the technology behind it.

## Non-goals

- The Instruments tab (it correctly separates generators from effects).
- Changing any plugin's DSP or implementation.
- Renaming plugin IDs or categories in their definitions.

## Requirements

### AC-001 — A single Effects tab in the sidebar

The browser sidebar must present one Effects tab for audio effects.

Verify with: `manual` — open the sidebar and confirm a single Effects tab is shown

### AC-002 — Plugins group by semantic function

Plugins must be grouped into `EFFECT_GROUPS` by their semantic category or ID, independent
of their technology stack.

Verify with: `pnpm test:run -- effectsTab`

### AC-003 — Each effect maps to exactly one group

Every registered effect plugin must map to exactly one `EffectGroup`.

Verify with: `pnpm test:run -- effectsTab`

### AC-004 — Premium plugins appear in their semantic groups

Premium effect plugins must appear inside their relevant semantic groups, not only as
isolated cards.

Verify with: `pnpm test:run -- effectsTab`

### AC-005 — No technology-based isolation

The effects UI must not branch on `id.startsWith('faust')` to place plugins.

Verify with: `manual` — grep the effects UI for `startsWith('faust')` and confirm none remain

### AC-006 — The effects route resolves its sub-routes

The sidebar must route `effects` and its sub-routes (e.g. `effects-audiofx`,
`effects-audiofx-group`) to the unified tab.

Verify with: `pnpm test:run -- Sidebar`

### AC-007 — No cross-module internal imports

This feature must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-008 — FX Chain Presets survive the merge into the Effects tab

The FX Chain Presets formerly shown in the Stage tab must appear in the unified Effects tab.

Verify with: `manual` — open the Effects tab and confirm the FX Chain Presets are present

### AC-009 — UI follows the existing design system tokens

The effects UI styling must adhere to the existing design system tokens and Tailwind usage.

Verify with: `manual` — review the effects UI and confirm it uses existing design system tokens and Tailwind classes rather than ad-hoc styles

### AC-010 — Old color-*/stage-* routes redirect to the unified effects route

The sidebar must redirect the deprecated `color-*` and `stage-*` routes to the unified `effects` route during mount, so existing user bookmarks and deep links still resolve.

Verify with: `pnpm test:run -- Sidebar` — a smoke test asserts a `color-*`/`stage-*` route resolves to the unified effects tab

## Open questions

- [ ] None.

## Affected areas

- `src/modules/Workspace/presentations/views/EffectsTab.tsx`
- `src/modules/Workspace/presentations/views/Sidebar.tsx`
- `src/modules/Workspace/presentations/views/effectsTabHelpers.tsx`

## Dropped from sources

- Keeping separate Color and Stage tabs — the Tone/Mix split is subjective and overlapping; a single hierarchical Effects tab is the DAW-standard.
- Removing premium cards or rendering them as plain rows — their colors and visual weight are preserved by pinning them within their group.
- Old `color-*` / `stage-*` deep links — redirected to the unified route so existing bookmarks still resolve.
