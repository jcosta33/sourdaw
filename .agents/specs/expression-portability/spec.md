---
type: spec
id: SPEC-expression-portability
title: Per-note expressive portability
status: draft
owner: The Sourdaw team
sources:
  - intake/differentiators.md
  - intake/full-spec.md
  - intake/future-spec.md
---

# Per-note expressive portability

## Intent

Keep note-level expressive intent durable when material crosses instruments,
plugin formats, protocols, and render engines. The user picks a mapping strategy,
the system applies explicit fallback projections, and a Portability Report states
what was preserved, approximated, dropped, or transformed. No expressive downgrade
happens silently.

## Non-goals

- The expression editing model and views (see `performance-expression`).
- Instrument capability discovery itself (see `instrument-semantics`) — this spec
  consumes a target-capability descriptor, it does not build the discovery flow.
- CLAP note-expression querying in the Rust host (a dependency, tracked under plugin hosting).

## Requirements

### AC-001 — Four explicit mapping strategies

The mapper must implement `literal`, `expressive-equivalent`, `conservative`, and
`target-optimized`, selectable as a per-track default and a per-paste override.

Verify with: `pnpm test:run -- projectExpression`

### AC-002 — Portability report on any downgrade

When a move approximates or drops any expression, a report listing preserved /
approximated / dropped fields must be produced and surfaced (e.g. a paste toast).

Verify with: `pnpm test:run -- portabilityReport`

### AC-003 — Conservative strategy sends only certain expression

When pasting with `conservative` onto a target of unknown note-expression support,
only velocity and pitch must be sent and the report lists pressure/slide/pitch-bend as dropped.

Verify with: `pnpm test:run -- projectExpression`

### AC-004 — Target-optimized routes to native strengths

When pasting with `target-optimized` onto a target declaring CC11 expression,
pressure must route to CC11.

Verify with: `pnpm test:run -- projectExpression`

### AC-005 — Per-note pitch falls back to channel allocation

When the target lacks per-note pitch but supports MPE, the mapper must allocate one
channel per active note and emit channel pitch bend, honoring a max-simultaneous-notes hint.

Verify with: `pnpm test:run -- mpeChannelAllocation`

### AC-006 — Mapping runs at paste and at scheduling dispatch

Expression projection must be applied both on clipboard paste and on scheduling
dispatch to a worklet/plugin target, using the selected strategy.

Verify with: `pnpm test:run -- scheduleMidiNotes`

### AC-007 — Target-optimized routing is reported as approximated

When pasting with `target-optimized` onto a target declaring CC11 expression and
pressure routes to CC11, the report must mark it `approximated: pressure → CC11`.

Verify with: `pnpm test:run -- projectExpression`

## Open questions

- [ ] (non-blocking) Default per-track strategy: `expressive-equivalent` proposed —
  confirm against user expectations for built-in synths.
- [ ] (non-blocking) Should the original rich semantics be retained so re-upgrading to a
  richer target recovers them? Default: yes, kept in session memory where present.

## Affected areas

- `src/modules/MIDI/services/` (portability mapper)
- `src/modules/Arrangement/useCases/clipboard/`, `models/Track.ts` (per-track strategy)
- `src/modules/Transport/useCases/scheduling/`

## Dropped from sources

- C2PA-style provenance recording of portability loss — provenance lives in
  `export-provenance`; this spec records loss only in the diff/report surface.
