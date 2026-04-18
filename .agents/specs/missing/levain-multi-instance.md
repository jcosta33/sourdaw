# Levain Multi-Instance Architecture

## Context

The Levain plugin currently uses a singleton pattern for its UI state (`levainStore`) and its engine bridge (`levainBridge`). This prevents users from adding multiple Levain instruments to different tracks, as they overwrite each other's parameters, share the same UI state, and cross-talk to the wrong AudioWorklet.

## Goal

Enable true multi-instance support for the Levain plugin. Each Levain device in the project must have its own isolated UI state, parameter map, and bridge connection to its corresponding Rust AudioWorkletNode.

## User-visible behavior

- Adding two Levain devices to different tracks yields two fully independent instruments. Opening the UI for Device A shows Device A's patch and parameter values; Device B is unaffected by changes in A.
- Loading a sample into Device A triggers the loading spinner on Device A only; Device B continues to play.
- Saving/loading a project restores all Levain instances with their individual patches intact.
- No visible cross-talk: MIDI notes routed to Track A's Levain do not sound from Track B's Levain.

## Scope

**In scope:**

- Per-`deviceId` UI stores, parameter maps, and bridge/`MessagePort` routing.
- Cleanly handing off `deviceId` from the DAW shell to the plugin panel + bridge at mount time.
- Backwards compatibility: single-instance usage continues to work.

**Out of scope:**

- Fixing the missing DSP macro parameters (Tone, Attack, Release) or legato transitions (covered in the audit but deferred for a separate task).
- Refactoring `LevainPatch` to be entirely hosted in the project state instead of the UI store (isolate the UI store first; consider a deeper project state migration later if needed).
- Any other plugin's multi-instance behavior (fix Levain first; replicate the pattern elsewhere separately).

## Requirements
1. **Device-Scoped Stores:** The global `levainStore` must be replaced by a mechanism that provides an isolated store per `deviceId`.
2. **Device-Scoped Bridge:** The `levainBridge` must manage a registry of active Levain devices and their `MessagePort`s keyed by `deviceId`.
3. **No Domain Leakage:** The plugin code must not import `getAllTracks` from the Arrangement domain to discover its own ID. The DAW shell must pass the `deviceId` to the plugin panel or bridge upon initialization.
4. **Independent Loading States:** The `LevainLoadingSpinner` must only show loading progress for its specific `deviceId`, not a global progress.
5. **No regressions:** Single-instance usage must continue to work flawlessly, including parameter persistence, macros, sample loading, and DSP processing.

## Constraints

- Must not introduce cross-module boundary violations: `levainBridgeDependencies.ts` must not import `getAllTracks` from the Arrangement domain to discover its own `deviceId`.
- RT-safety preserved: the bridge registry lookup happens off the audio thread; audio-thread code receives the correct `AudioWorkletNode` handle directly.
- No regressions in single-instance flows (parameter persistence, macros, sample loading, DSP processing).

## Design decisions

- **Decision:** Use a Vanilla `Store<T>` keyed by `deviceId` (map of `Map<deviceId, Store<LevainUiState>>`), not React Context.
    - **Why:** Keeps cross-domain UI state in the established store pattern (see `AGENTS.md` — Vanilla Store). React Context would force re-renders on unrelated consumers.
    - **Alternatives rejected:** (a) Context per plugin instance — breaks the "Context for deeply local view state only" rule. (b) Moving all state to project state — too invasive for v1; explicitly out of scope.
- **Decision:** The DAW shell passes `deviceId` to the plugin panel at mount time as a regular React prop.
    - **Why:** Avoids domain leakage and makes the plugin's dependencies explicit.
- **Decision:** Bridge registry lives in `levainBridge`, keyed by `deviceId`, owning one `MessagePort` per active device.

## Acceptance criteria

- [ ] `pnpm deps:validate` passes with zero violations (especially ensuring `levainBridgeDependencies.ts` no longer imports `getAllTracks`).
- [ ] `LevainPanel` accepts a `deviceId` prop and correctly reflects the state of **only** that device.
- [ ] `LevainLoadingSpinner` only spins for the specific device that is currently loading samples.
- [ ] Modifying a parameter on Levain Device A does not affect the audio or UI of Levain Device B.
- [ ] Saving and reloading a project with two Levain instances restores both patches independently.
- [ ] MIDI notes routed to Track A's Levain do not sound from Track B's Levain (observable in output meters and rendered audio).

## Implementation notes

- The device-scoped store registry should hand out per-`deviceId` stores lazily on first access; cleanup on device removal must release the store and tear down the `MessagePort`.
- Consider a lightweight `useLevainDeviceStore(deviceId)` hook that wraps `useStore` to keep the calling components idiomatic.
- Reuse existing patterns from any other device that already has per-instance state (search `src/modules/Factory/` before inventing new patterns).

## Test plan

- Unit: per-`deviceId` store isolation — writes to store A do not alter store B.
- Integration: two Levain devices mounted simultaneously, parameter edits flow to the correct worklet.
- E2E: project save/load round-trip with two Levain instances; verify both patches persist.
- Manual: audio-path verification via meters and rendered bounce.

## Open questions

- `[CRITICAL]` How does the DAW framework initialize device panels and bridges? Does it pass the `deviceId` and `MessagePort` cleanly, or do we need to alter the plugin registration lifecycle?

## Tradeoffs and risks

- **Risk:** Subtle MIDI or audio routing regressions if the bridge registry fails to clean up `MessagePort`s on device removal — may cause phantom voices or memory leaks. Mitigation: explicit teardown test and an assertion that the registry is empty after closing the project.
- **Trade-off:** Deferring the deeper project-state migration keeps this change small but leaves `LevainPatch` living in the UI store — revisit once multi-user collaboration requires CRDT-backed patch state.

---

## Implementation Status

**What is implemented:**
- None. The `levainStore.ts` still uses a singleton `levainStore` rather than a registry.

**What is not implemented:**
- All features described in the spec, including `LevainRegistry`, keyed store management, and multi-instance UI. `LevainPanel.tsx` still consumes the singleton store and does not accept a `deviceId`.

**What is done well:**
- N/A

**What needs refactoring:**
- The entire Levain module needs to transition from singletons to keyed registries as described in the spec.
