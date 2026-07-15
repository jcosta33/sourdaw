---
type: spec
id: SPEC-ai-ghost-surfaces
title: AI ghost preview surfaces
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# AI ghost preview surfaces

## Intent

Render AI suggestions as reversible, auditionable "ghost" overlays that never touch the project
model until accepted: ghost MIDI clips, ghost audio clips (with provenance), and ghost automation
overlays (with diff view). All share one visual language and control grammar (Tab accept, Escape
dismiss, Alt+]/[ cycle). Routing suggestions are explicitly deferred, and every AI feature declares
a Web/Rust/Mixed execution tier.

## Non-goals

- The generators that emit suggestions (audio generation, volume-riding analyzer) — only the
  preview surfaces.
- Ghost routing/send/bus previews — deferred to a later version.
- A trust/confidence scoring formula — research-only.

## Requirements

### AC-001 — Ghost MIDI clips preview without entering the model

Ghost MIDI clips must render as semi-transparent dashed blue/purple elements with accept (Tab/
click), dismiss (Escape), cycle (Alt+]/[), and a shimmer during generation, never persisting until
accepted.

Verify with: `pnpm test:run -- AI ghostMidiClip`

### AC-002 — Accepting a ghost MIDI clip commits it

Acceptance must convert the ghost into a normal committed clip in the project model.

Verify with: `pnpm test:run -- AI acceptGhostMidiClip`

### AC-003 — Ghost audio clips audition through the full chain

A ghost audio clip must render with desaturated waveform styling and audition in-place through the
track's inserts/sends/bus on Space without mutating the model.

Verify with: `manual` — focus a ghost audio clip, press Space, and confirm audition through downstream inserts with no model change

### AC-004 — Accepting a ghost audio clip persists buffer and provenance

Accepting must write the rendered buffer to project sample storage and copy read-only provenance
(model id+version, prompt, timestamp, seed) onto the committed clip's `aiProvenance`.

Verify with: `pnpm test:run -- AI acceptGhostAudioClip`

### AC-005 — Ghost automation overlays render as a diff

Ghost automation must render at ≈40% opacity above the committed curve with a green/red diff
toggle.

Verify with: `pnpm test:run -- AI ghostAutomationOverlay`

### AC-006 — Ghost state never serializes before accept

No ghost MIDI, audio, or automation state may appear in project-model, render output, undo history,
or automation-lane serialization until accepted.

Verify with: `pnpm test:run -- AI ghostSerializationGuard`

### AC-007 — Ghost routing suggestions are excluded in v1

No code path may produce a ghost preview for routing, sends, or bus assignments; any such change
commits directly.

Verify with: `manual` — search `src/` for ghost-routing state and confirm no hits

### AC-008 — Every AI feature declares an execution tier

Each AI feature must document a Web, Rust, or Mixed execution tier, with heavy generation (e.g.
DiffSinger/ACE-Step) running in the Rust tier.

Verify with: `manual` — confirm each AI feature has a recorded tier and the E2 generation path runs via a Tauri/sidecar call, not a browser model load

### AC-009 — Accepting a ghost automation overlay commits in one undoable entry

Tab must accept the whole range — or only the active time-range intersection — in one undoable
entry.

Verify with: `pnpm test:run -- AI ghostAutomationOverlay`

## Open questions

- [ ] (non-blocking) Revisit ghost routing previews after these surfaces ship and demand surfaces.
- [ ] (non-blocking) Define future staged mixer previews (gain, pan, and plugin-parameter changes):
  decide whether they reuse the automation diff surface or need a mixer-specific preview. Routing,
  send, and bus previews remain excluded by AC-007.

## Affected areas

- ghost-clip UI state (UI-layer only) in the Workspace/Arrangement presentation layer
- Clip model `aiProvenance` field; automation lane overlay rendering

## Dropped from sources

- Ghost routing/send suggestions (deferred) and AI trust scoring (research-only).
