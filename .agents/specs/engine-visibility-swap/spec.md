---
type: spec
id: SPEC-engine-visibility-swap
title: Engine visibility, swappability, and A/B comparison
status: draft
owner: The Sourdaw team
sources:
  - intake/full-spec.md
  - intake/future-spec.md
  - intake/differentiators.md
---

# Engine visibility, swappability, and A/B comparison

## Intent

Make the engine behind every rendered artifact visible, the active LLM backend
swappable mid-session without losing project state, and two engines' output on the
same phrase comparable as variants. This is the restrained, useful subset of an
"engine rack" — the active chain shown in one line, not an AI-infrastructure dashboard.

## Non-goals

- A full model-and-engine rack with per-track slots and drag-replacement (future-spec G
  vision, deliberately not built).
- The traditional DAW device rack (that is the separate `device-racks` feature).
- The runtime strip's base segments (see `runtime-transparency`); this extends it.
- The variants infrastructure used for A/B (see `variation-native-clips`).

## Requirements

### AC-001 — Every rendered artifact records its engine

Render-provenance, freeze state, and AI-generated clips must each record the producing
engine identity plus fallback-used and fallback-reason fields.

Verify with: `pnpm test:run -- renderProvenanceEngine`

### AC-002 — Runtime strip shows the active engine chain

The runtime strip must show the active engine per subsystem (LLM / AI render / DSP) on
one line, expandable to the full fallback chain with the reason each tier was chosen.

Verify with: `pnpm test:run -- engineChainSegment`

### AC-003 — Swap the LLM backend mid-session

A swap use case must re-resolve the backend with a forced override, abort in-flight
inference cleanly, and record the swap in action history for undo.

Verify with: `pnpm test:run -- swapBackend`

### AC-004 — Swap preserves all session state

After an LLM backend swap, MIDI notes and expression, clip-level metadata, automation,
routing, and frozen buffers must be unchanged; the next inference runs on the new backend.

Verify with: `pnpm test:run -- swapBackendStatePreserved`

### AC-005 — A/B re-render lands as variants

When the user re-renders a clip with a different engine, the result must land in a new
variant tagged with its engine identity, auditioned in place against the original.

Verify with: `pnpm test:run -- reRenderWithEngine`

## Open questions

- [ ] (non-blocking) Swappability for AI render and DSP subsystems (beyond LLM) — v1
  ships LLM swap; render/DSP swap is a fast-follow. Confirm scope.

## Affected areas

- `src/modules/BrowserAi/models/RenderProgress.ts` (RenderProvenance.engine)
- `src/modules/Arrangement/models/Track.ts` (FreezeState/Clip renderedBy)
- `src/modules/AiRuntime/useCases/llmOrchestration/` (swapBackend)

## Dropped from sources

- A standalone A/B panel — comparison reuses the variant compare/audition flow.
- Engine determinism declarations and dry-run capability queries (future-spec G
  technical) — deferred to a follow-up.
