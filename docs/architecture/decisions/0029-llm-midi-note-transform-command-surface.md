# ADR 0029: Initial LLM MIDI note-transform command surface

**Status:** Accepted

## Context

Sourdaw already has provider tool schemas, app actions, Command handlers, and CRDT-backed MIDI writes for whole-clip MIDI note transforms. Those operations are not in the executable app-action registry or grounded LLM bridge, most retain unchecked runtime payloads, and the handlers marked undoable do not provide inverse actions, so their current undo entries are inert.

The first executable LLM slice must admit only deterministic, bounded operations against an exact editable MIDI clip and must make their claimed undo behavior real before exposing them to providers. Implementation is dependency-ordered: the shared AppAction mutation and replay contract lands first; the provider registry, grounding, confirmation, and batch-collision packet lands only after that prerequisite.

## Decision

- After the safe AppAction prerequisite lands, admit `quantizeNotes` and `transposeNotes` through the provider-neutral executable registry. Until the dependent registry packet lands, providers cannot propose either action. Later packets must repair and admit the remaining transforms rather than inheriting this admission implicitly.
- Ground both operations to one exact, unlocked, non-empty MIDI clip. Audio clips, locked clips, empty clips, missing targets, ambiguous references, provider-added fields, and requests scoped to selected notes rather than the whole clip are rejected before confirmation or execution.
- Expose only provider-owned arguments. Quantize strength and swing remain unavailable in this slice.
- Validate finite bounded values: quantize grids are greater than zero and at most 64 beats; transpose is a non-zero integer from -127 through 127 semitones.
- Classify whole-clip note transforms as broad or destructive reversible work and require confirmation. Confirmation descriptions name the clip, stable ID, and transform parameters.
- Add an internal-only MIDI note restore action containing complete expected and replacement snapshots. Undo restores only when the current notes still equal the captured post-transform state. Redo replays the captured post-transform snapshot only when the current notes still equal the captured pre-transform state. Either direction returns a conflict instead of recomputing against or overwriting divergent work.
- Route the piano-roll quantize and transpose controls through the same registered AppAction handlers; remove their callback-based undo paths so manual and LLM execution share one mutation contract.
- Treat the MIDI note collection as one batch mutation target. Reject multiple whole-clip note transforms on the same clip and any remove/transform lifecycle overlap rather than depending on provider call order.
- Continue to execute through the registered MIDI handlers inside `executeAppAction`, preserving CRDT history, receipts, and deterministic macro replay.
- Do not admit the other MIDI transforms in this packet. `humanizeNotes` and random `arpeggiate` require replay-identity review; `arpeggiate` also has provider/domain rate-unit disagreement; velocity transforms have schema/implementation disagreement; and every remaining handler needs an exact inverse.

## Consequences

The prerequisite gives manual callers and the future LLM bridge one shared, guarded AppAction path. Once the dependent registry packet lands, WebLLM and arbitrary hosted providers can safely propose whole-clip quantize and transpose operations without a server. Their confirmation, CRDT commit, undo/redo, and macro behavior are real and testable; the remaining transforms stay unavailable until they meet the same contract.
