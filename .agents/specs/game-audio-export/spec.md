---
type: spec
id: SPEC-game-audio-export
title: Game audio delivery (Wwise/FMOD export)
status: draft
owner: The Sourdaw team
sources:
  - intake/full-spec.md
---

# Game audio delivery (Wwise/FMOD export)

## Intent

Generate game-middleware-ready deliverables from a session: per-asset WAV exports
named by a configurable template, with arrangement sections/markers defining asset
boundaries, plus metadata suitable for Wwise containers or FMOD events. Start with
flat named WAV export (immediately useful) and add project-structure generation as a
follow-up.

## Non-goals

- Streaming-platform delivery presets (see `delivery-export-targets`).
- A live game-engine integration or runtime audio middleware.
- Full Wwise/FMOD project authoring beyond asset + metadata generation (follow-up).

## Requirements

### AC-001 — Sections define asset boundaries

Each region between markers/sections must export as one individual asset.

Verify with: `pnpm test:run -- gameAudioRegionExport`

### AC-002 — Configurable per-asset naming template

Asset filenames must be produced from a user-customizable template (e.g.
`{section}_{track}_{index}.wav`).

Verify with: `pnpm test:run -- gameAudioNamingTemplate`

### AC-003 — Silence-trimmed heads and tails

Each exported asset must have its silent head/tail trimmed.

Verify with: `pnpm test:run -- gameAudioSilenceTrim`

### AC-004 — Asset metadata export

Per-asset metadata (loop points, volume, priority) must be exported in a structured
form (Wwise-style XML or FMOD bank metadata).

Verify with: `pnpm test:run -- gameAudioMetadataExport`

## Open questions

- [ ] (non-blocking) Which middleware format to prioritize for v1 metadata — Wwise
  `.wwu` XML vs FMOD — pending demand. Default: flat WAV + Wwise XML first.

## Affected areas

- export dialog (Game Audio Export tab)
- existing marker/section system and offline render
- Rust backend tag/metadata writing

## Dropped from sources

- Live FMOD Studio scripting integration — out of scope; v1 generates files and metadata,
  it does not drive the middleware app.
