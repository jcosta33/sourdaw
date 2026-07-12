---
type: spec
id: SPEC-capture-inbox
title: Capture-anything project memory
status: draft
owner: The Sourdaw team
sources:
  - intake/differentiators.md
  - intake/full-spec.md
  - intake/future-spec.md
---

# Capture-anything project memory

## Intent

Pull the loose material around a session — voice notes, spoken instructions,
humming, rough lyrics, screenshots, reference audio, collaborator comments,
timeline bookmarks, plugin snapshots — into the project as linked, searchable
artifacts. Capture must be lower friction than leaving the DAW, and raw capture
stays linked to its derived result (e.g. a transcript).

## Non-goals

- Always-on MIDI rolling-buffer recovery of just-played material (that is the
  separate `retrospective-capture` feature; the name overlap is intentional).
- Turning captures into a heavy intent object model (see the restrained `timeline-goals`).
- Decision rationale capture (see `decision-memory`).

## Requirements

### AC-001 — Instant capture from anywhere

A global hotkey and a docked Capture Inbox panel must let the user capture a memory
artifact without navigating away from the current view.

Verify with: `manual` — press the capture hotkey from the arrangement and confirm a new artifact appears

### AC-002 — Record and store a voice note

When the user records a voice note, its raw audio payload must be stored as a
project artifact (not piped to the LLM) with a timestamp.

Verify with: `pnpm test:run -- captureVoiceNote`

### AC-003 — Attach an artifact to a timeline scope

An artifact must be linkable to a scope (track and/or beat range).

Verify with: `pnpm test:run -- linkArtifactToTimeline`

### AC-004 — Transcribe a voice memo

When transcription runs, a voice note must gain a derived transcript payload while
keeping its original audio.

Verify with: `pnpm test:run -- transcribeArtifact`

### AC-005 — Search across text, transcripts, and tags

Full-text search must return artifacts by transcript text and tags (e.g. searching
"hit harder" finds the note attached to bars 17–21).

Verify with: `pnpm test:run -- searchArtifacts`

### AC-006 — Captures persist and survive offline

Memory artifacts must serialize into project data and remain available offline and
through local-first collaboration sync.

Verify with: `pnpm test:run -- projectMemoryPersistence`

### AC-007 — A scope link persists with the project

The link between an artifact and its timeline scope must persist with the project.

Verify with: `pnpm test:run -- linkArtifactToTimeline`

## Open questions

- [ ] (non-blocking) Transcription backend: native whisper command vs Web Speech API
  fallback — default to native when available, web fallback otherwise.
- [ ] (non-blocking) Audio-embedding / phrase-similarity index — defer to a follow-up;
  v1 ships text + tag search only.

## Affected areas

- `src/modules/ProjectMemory/` (new module: model, store, capture/transcribe/search use cases)
- `src/modules/Project/models/ProjectData.ts` (local artifact type, persistence)
- `src/modules/Workspace/presentations/` (Capture Inbox panel, keyboard shortcut)

## Dropped from sources

- "Convert a capture into a branch/intent/task" automation — the convert-to-goal path
  lands once `timeline-goals` exists; v1 captures and links only.
- Melody extraction / beat alignment from hummed captures — deferred; depends on pitch
  and onset analysis.
