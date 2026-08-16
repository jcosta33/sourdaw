# ADR 0022: LLM track deletion

**Status:** Accepted

## Context

ADR 0016 kept `removeTrack` outside provider tool plans until destructive authorization and confirmation were designed. The AppAction handler now snapshots and restores the removed track, ordering, selection, routing, sidechains, modulation, automation, MIDI, take lanes, and committed runtime graph. ADR 0021 also binds pending AppAction proposals to the complete project revision. Meanwhile, the local prompt parser can already propose `removeTrack`, leaving provider planning and the fast path with different admission rules.

## Decision

- Admit `removeTrack` as a `destructive-reversible` executable action that always requires explicit confirmation.
- Accept only an exact `trackId` grounded by literal ID, unique exact name, or explicit selection to an existing non-master track.
- Apply the same non-master restriction to the local prompt fast path; neither planning path may turn a request for the master track into an executable deletion.
- Show the resolved track name in the action description presented for confirmation and receipts.
- Bind confirmation to the planned project revision and execute confirmed deletion through the atomic AppAction batch path.
- Reject repeated deletion of the same track in one provider batch. On commit, use the existing `restoreTrack` inverse for undo and compensation.

## Consequences

Track deletion has one provider-neutral admission and execution path across WebLLM and hosted providers. A model cannot delete a track without an explicit, fresh confirmation, cannot target the master track, and cannot bypass Automerge receipts or exact restoration. Manual internal teardown operations that intentionally remove the master remain outside the provider boundary.
