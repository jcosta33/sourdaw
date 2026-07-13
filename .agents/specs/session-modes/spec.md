---
type: spec
id: SPEC-session-modes
title: Hardware-adaptive session modes
status: draft
owner: The Sourdaw team
sources:
  - intake/differentiators.md
  - intake/full-spec.md
  - intake/future-spec.md
---

# Hardware-adaptive session modes

## Intent

A small set of clear session modes — sketch, preview, review, production,
final-render — that are execution policies, not marketing labels. The same project
stays editable and musically meaningful on a lightweight browser runtime and
upgrades render quality on desktop without breaking continuity. Each artifact may
hold multiple fidelity realizations linked to one semantic source (multi-resolution).

## Non-goals

- The runtime strip that displays the active mode (see `runtime-transparency`).
- The capability model answering "can feature X run here" (see `chrome-first-capability`).
- Per-AI-action autonomy (see `ai-trust-modes`).

## Requirements

### AC-001 — Session mode is a cross-cutting store, not a module

Session mode must be a `Store<SessionModeState>` (current mode, bias, detected
capabilities, effective constraints) initialized from platform capabilities — no new
domain module.

Verify with: `pnpm test:run -- sessionMode`

### AC-002 — Modes map to concrete execution constraints

Each mode must resolve to constraints (max polyphony, native-plugins on/off, render
quality, heavy-DSP on/off) that downstream subsystems read and honor.

Verify with: `pnpm test:run -- sessionConstraints`

### AC-003 — Review differs from production on the engine side

Review mode must engage all processors (tails, oversampling, slower renderers) while
relaxing editing latency; production stays editing-biased.

Verify with: `pnpm test:run -- sessionMode`

### AC-004 — Same project opens coherently across runtimes

Opening a project in the browser must select a lighter mode and on desktop a heavier
mode by auto-detection, without manual reconfiguration and without losing edits.

Verify with: `manual` — open one project in browser then desktop; confirm modes auto-select and content is identical

### AC-005 — Mode and bias persist with the project

Session mode and bias (interactivity / quality / power-save) must serialize into
project data, defaulting to capability-based auto-detection.

Verify with: `pnpm test:run -- sessionModePersistence`

### AC-006 — Higher-tier realizations share lineage

When a selection is re-rendered at a higher tier, the higher- and lower-tier outputs
must share lineage to one semantic source rather than becoming unrelated files.

Verify with: `pnpm test:run -- fidelityRealizationLineage`

## Open questions

- [ ] (non-blocking) Should section-level fidelity promotion ship in v1 or follow the
  base mode selector? Default: mode selector first, section promotion as a fast-follow.

## Affected areas

- `src/utils/sessionMode.ts` (new store), reads `platformCapabilities`, `capabilityDetector`
- `src/modules/BrowserAi/`, `src/modules/AudioEngine/` (constraint consumers)
- `src/modules/Project/models/ProjectData.ts`

## Dropped from sources

- The future-spec "Fidelity Matrix" as a standalone panel — folded in as per-asset
  realization metadata rather than a dedicated UI surface.
- A central render planner that schedules background HQ promotion — deferred to a
  follow-up once the mode/constraint plumbing is in place.
