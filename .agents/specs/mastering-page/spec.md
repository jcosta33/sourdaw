---
type: spec
id: SPEC-mastering-page
title: Integrated mastering page
status: draft
owner: The Sourdaw team
sources:
  - intake/full-spec.md
---

# Integrated mastering page

## Intent

A dedicated mastering workspace (a Studio One-style Project Page) that imports
finished mixes as tracks, provides per-track and master processing via the existing
Proof suite, offers streaming-target loudness presets, supports multi-format export,
and relinks each mastering track to its originating mix session.

## Non-goals

- The per-plugin progressive-disclosure UI (see existing `effects-mastering-ui`).
- Streaming-target delivery presets as a general export feature (see
  `delivery-export-targets`) — the mastering page consumes them.
- The loudness measurement engine (see `loudness-metering-ebur128`).
- The mastering translation workflow — translation-curve monitoring (Car / Phone / Mono /
  …) and A/B/C reference-track comparison. Intake `implementation-gaps.md` §5.6 ("Mastering
  Translation Workflow") is realized in `effects-mastering-ui` **AC-012** (Proof's Route
  tier), not on this page; the mastering page reaches it through the Proof instances it
  hosts.
- A new mastering module — this composes existing Arrangement, Proof, AudioAnalysis,
  and Project modules into a workspace view mode.

## Requirements

### AC-001 — A distinct master workspace mode

The workspace view switcher must offer a `master` mode that renders a mastering layout
distinct from the arrangement view.

Verify with: `pnpm test:run -- AppShell`

### AC-002 — Import finished mixes as mastering tracks

The mastering page must import audio mixes as audio-only mastering tracks (no MIDI).

Verify with: `pnpm test:run -- importMasteringTrack`

### AC-003 — Per-track Proof processing chain

Each mastering track must host a Proof instance for mastering processing.

Verify with: `pnpm test:run -- masteringChain`

### AC-004 — Target loudness presets adjust the meter target

Selecting a delivery target preset must adjust the LUFS target line in the metering
display.

Verify with: `pnpm test:run -- masteringTargetPreset`

### AC-005 — Relink a mastering track to its mix session

Each mastering track must store a pointer to its source mix session and reopen that
project on double-click.

Verify with: `manual` — double-click a mastering track and confirm its source mix project opens

## Open questions

- [ ] (non-blocking) Multi-window mix reopen vs in-place navigation — default to a new
  window on desktop; in-place on browser.

## Affected areas

- `src/modules/Workspace/presentations/views/AppShell.tsx` (master mode + layout)
- reuses Proof, LUFS/phase metering components, ExportDialog

## Dropped from sources

- A bespoke mastering DSP suite — out of scope; the page composes the existing Proof
  suite rather than introducing new processing.
