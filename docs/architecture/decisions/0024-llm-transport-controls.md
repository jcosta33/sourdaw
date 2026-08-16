# ADR 0024: LLM transport controls

**Status:** Accepted

## Context

Loop and metronome configuration are durable Automerge-backed project state, but their existing toggle and setter handlers either depend on current state or claim undoability without emitting an inverse. Provider commands must be idempotent, retry-safe, and truthfully undoable. Playback and recording controls also trigger scheduler, audio, MIDI, and recording-finalization effects that cannot be compensated as ordinary project writes.

## Decision

- Add explicit `setLoopEnabled` and `setMetronomeEnabled` AppActions instead of exposing state-dependent toggles for on/off intent.
- Expose `setLoopEnabled`, `setLoopRegion`, `setMetronomeEnabled`, and `setMetronomeVolume` through the executable action registry with exact payload schemas and bounded values.
- Make the `setLoopRegion` AppAction change loop bounds only; enabling or disabling looping is a separate explicit `setLoopEnabled` write. Existing direct UI calls may continue requesting the established set-and-enable behavior.
- Include current loop bounds, loop enabled state, metronome enabled state, and metronome volume in bounded provider project context.
- Mint inverses from pre-execution transport state and add no-op checks for repeated desired state.
- Restore the complete previous loop snapshot atomically through an internal `restoreLoopRegion` action.
- Reject enabling an invalid zero-length loop with a no-write outcome, malformed regions, implicit numeric values, and repeated writes to the same loop or metronome field; allow one bounds write and one explicit enabled-state write in a provider batch.
- Require both sibling calls for an explicit compound loop-bounds-and-enabled request, validate enablement against same-batch prospective bounds, and canonicalize execution as bounds before enabled state.
- Defer `stopPlayback`, playback toggles, recording, count-in, pre-roll, and punch controls until their runtime and recording effects have deliberate confirmation and compensation semantics.

## Consequences

WebLLM and hosted providers can configure loop and metronome project state through the same validation, grounding, Automerge transaction, receipt, and undo path. Repeated commands are idempotent, loop bounds never hide an enabled-state side effect, region undo preserves prior loop state, and runtime transport side effects remain outside the provider allowlist.
