# ADR 0027: LLM automation transform command surface

**Status:** Accepted

## Context

The provider-neutral executable registry can create automation lanes and points and enable lanes, but existing typed actions for track automation mode and whole-lane transforms remain unreachable. The application already owns lossless inverse snapshots for scale, stretch, invert, reverse, thin, and quantize operations, and macro playback already remaps their lane IDs.

Provider execution still needs stricter admission than manual commands. Transform inputs can otherwise admit non-finite or destructive numeric values, empty-lane no-ops, ambiguous lane references, or order-dependent writes that combine point insertion with a whole-lane transform in one batch. Track automation mode also lacks an inverse despite being marked undoable.

## Decision

- Expose `setAutomationMode`, `scaleAutomation`, `stretchAutomation`, `invertAutomation`, `reverseAutomation`, `thinAutomation`, and `quantizeAutomation` through the executable LLM registry and bridge.
- Ground every transform to one exact non-clip automation lane, scoped by its owner track when lane names repeat; ground automation mode to one exact track.
- Publish the current track automation mode in app-owned and provider-bounded project context.
- Accept only an explicitly named, unambiguous existing automation mode; finite scale and stretch factors greater than zero and at most 16; omitted thinning tolerance as the app-owned default or an explicitly named finite tolerance greater than zero and no greater than the lane value span; and finite quantization grids greater than zero and at most 64 beats.
- Reject obvious no-ops, transforms without enough points to change, repeated transforms of one lane, and batches that combine whole-lane transforms with point insertion on the same lane.
- Keep transform-only anchors internal, so provider payloads cannot choose undocumented replay or pivot fields.
- Make automation-mode changes exact no-ops when unchanged and preserve expected-current state in their inverse; retain whole-lane point snapshots as lossless inverses that conflict rather than overwrite later lane edits.
- Classify automation mode as authority-sensitive, scale/stretch/invert/reverse as broad-reversible, and thin/quantize as destructive-reversible so every newly exposed command requires confirmation.

## Consequences

Providers can perform typed, confirmed vibe-mixing edits over existing automation without bypassing grounding, `executeAppAction`, Automerge history, receipts, conflict-safe undo, or macro lane-ID remapping. Manual actions retain their existing richer internal payloads, while provider transforms use the smaller admitted surface and cannot smuggle non-finite values or hidden anchors.
