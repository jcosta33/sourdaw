# ADR 0016: LLM track creation and organization

**Status:** Accepted

## Context

The provider-neutral LLM bridge can already mutate mix values, but it cannot create, duplicate, order, or color tracks. Those actions already exist in the application command registry, yet creation handlers do not currently identify their result before execution and therefore cannot supply deterministic compensation for an atomic LLM batch.

Track deletion is not exposed to providers in this decision. This slice repairs its existing internal inverse so creation compensation and ordinary undo are trustworthy, but destructive provider authorization remains a separate product decision.

## Decision

- Expose `addTrack`, `duplicateTrack`, `reorderTrack`, and `setTrackColor` through the strict LLM tool allowlist.
- Accept only exact arguments, existing source track IDs, valid track kinds, in-range integer positions, safe project names, and six-digit hexadecimal colors.
- Mint add/duplicate destination IDs during handler preflight, reuse those IDs during execution, and compensate with removal of the exact created track.
- Add an app-owned, non-provider argument that makes provider-requested creation selection-neutral while ordinary commands retain their existing selection behavior.
- Compensate creation with an internal idempotent discard action, so an already-aborted staged creation cannot stop reverse compensation of earlier runtime effects.
- Defer track events and live-engine removal until the owning Command transaction commits; aborted batches publish nothing and retain their prior runtime graph.
- Restore removed tracks with their original order and selection, rewritten outputs and sends, sidechains, modulators and mappings, automation, MIDI, take lanes, and post-commit live graph.
- Admit at most one reorder per provider batch and reject stale indices instead of clamping them, because independent absolute-index inverses do not compose.
- Treat destination collisions, unchanged positions, and unchanged colors as no-ops; treat missing or newly non-duplicable sources as replay conflicts.
- Keep `removeTrack` unavailable to provider tool plans until destructive authorization and confirmation semantics are explicitly designed.

## Consequences

Provider plans can perform common project-organization work through `executeAppActionBatch`, Automerge, undo history, and the same registered handlers as the UI. Multi-action plans remain confirmation-gated and atomically compensable. Arbitrary CSS values and destructive track deletion remain outside the LLM boundary.
