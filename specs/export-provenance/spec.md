---
type: spec
id: SPEC-export-provenance
title: Export-oriented provenance
status: draft
owner: The Sourdaw team
sources:
  - intake/full-spec.md
  - intake/future-spec.md
---

# Export-oriented provenance

## Intent

Produce a silent, export-time provenance report that classifies every clip's origin
(recorded / imported / ai-generated / sample-library / ai-transformed) and can attach
to the project file, an audio sidecar, or an archive. It supports rights, disclosure,
and competition workflows quietly — zero UI during normal export — and maps toward
C2PA-compatible structures where feasible.

## Non-goals

- Making provenance a mainstream headline feature (explicitly restrained).
- Cryptographic signing / C2PA packaging at v1 (architecture must allow it later).
- Trust-mode enforcement (see `ai-trust-modes`) and engine identity (see
  `engine-visibility-swap`), which this report consumes.

## Requirements

### AC-001 — Clips and notes carry a source origin

Clip and note models must carry an optional source-origin field, populated at creation
by the recording, import, AI, and sample-library use cases.

Verify with: `pnpm test:run -- sourceOrigin`

### AC-002 — Provenance report is a pure function over project data

A report generator must walk tracks/clips/notes and return a structured summary plus
per-clip origin (and engine where available) with no side effects and no UI.

Verify with: `pnpm test:run -- generateProvenanceReport`

### AC-003 — Mixed-origin clip records most-recent origin

When a clip's origin changes (e.g. a recorded clip transformed by AI), source-origin
must reflect the most recent origin while the prior state is preserved in its variant.

Verify with: `pnpm test:run -- sourceOriginTransform`

### AC-004 — Report attaches at the chosen export points

The report must be embeddable in the project file and writable as a sidecar
`provenance.json` for audio export (and included in archive exports).

Verify with: `pnpm test:run -- exportProvenanceAttachment`

### AC-005 — Zero forced UI

Normal export must show no provenance UI beyond a single opt checkbox.

Verify with: `manual` — export a mixed-origin project and confirm provenance.json classifies every clip with no extra prompts

### AC-006 — Mixed-origin classification is correct

Classification must be correct for a mixed recorded + AI + sample-library project.

Verify with: `manual` — export a mixed-origin project and confirm provenance.json classifies every clip with no extra prompts

## Open questions

- [ ] (non-blocking) C2PA-compatible packaging and signing — architecture must support
  it; v1 ships the internal JSON manifest and sidecar only. Confirm deferral.

## Affected areas

- `src/modules/Arrangement/models/Track.ts`, `src/modules/MIDI/models/MidiNote.ts`
- `src/modules/Project/useCases/exportProvenance.ts`, `models/ProjectData.ts`
- `src/modules/Project/useCases/exportActions.ts`, `ExportDialog.tsx`

## Dropped from sources

- Rights-policy export gating / warnings (future-spec M) — deferred; v1 classifies and
  reports, it does not block export on policy.
