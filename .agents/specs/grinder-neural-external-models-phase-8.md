# Grinder Neural External Models Phase 8

## Context

Phase 7 made Grinder's built-in Neural browser real, but the Neural modal still stops at factory slots. Research now shows the most credible next contract is documented NAM `.nam` JSON import: it is structured, importable in the current browser/WASM architecture, and bounded enough to ship without waiting for full third-party runtime parity.

The current engine already supports the pattern needed for this phase:

- the UI can import local files
- Grinder patches can carry compact structured data
- the browser audio engine already has a `setPatch`-style transport pattern for other WASM devices

This phase uses those facts to deliver a real external Neural model path.

## Goal

The Neural modal can import documented NAM capture files, keep them in a reusable imported library, and apply the selected imported capture as a real live DSP profile instead of only supporting factory slots.

## User-visible behavior

Users can import one or more `.nam` captures from the Neural modal. Imported captures appear in the modal alongside factory entries, show real metadata, and can be selected like any other Neural voice. When selected, the imported capture changes the live Grinder sound immediately. Reopening the modal restores the imported library, and imported selections remain sonically correct because the active patch carries the compact derived profile data.

## Scope

**In scope:**

- Import documented NAM `.nam` JSON files from the Neural modal.
- Validate imported files and reject malformed/unsupported payloads without crashing.
- Derive a compact Grinder neural profile from imported NAM data.
- Persist imported model entries in a Grinder-local IndexedDB library for modal reuse.
- Store the selected imported compact profile in the Grinder patch so project playback does not depend on modal-library restore timing.
- Send imported profiles to the Grinder worklet through a structured patch payload.
- Apply imported custom profiles inside `crates/daw-dsp/src/grinder/neural.rs`.
- Expose imported-model inventory and import actions in the Neural modal.
- Update the Grinder audit/task trail for the new external-model behavior.

**Out of scope:**

- Full NAM reference-fidelity runtime parity.
- AIDA-X import.
- External IR/cab import.
- Routing-mode completion.
- Cloud/library sync or project-bundle asset export.
- Imported-model editing, tagging, or deletion UX beyond basic listing/selecting.

## Requirements

1. **The Neural modal imports real external model assets**
   Users must be able to import one or more local `.nam` files from the Neural modal.

2. **Imports are validated**
   Malformed JSON, missing required NAM structure, or empty/invalid weight payloads must be rejected with a visible error state instead of crashing or silently succeeding.

3. **Imported entries are reusable**
   Successfully imported models must persist in a Grinder-local library so the modal can show them again after a reload.

4. **Imported selections are project-portable**
   Selecting an imported model must write its compact derived profile into the Grinder patch so the live sound does not depend solely on the reusable library being restored first.

5. **Imported models reach the live DSP**
   Selecting an imported model must send a structured custom-profile payload through the browser audio engine into the Grinder worklet/Rust neural path.

6. **Imported profiles sound distinct**
   Different imported profiles must produce measurably different DSP output for the same input stimulus.

7. **Built-in models keep working**
   Factory Neural library entries must continue to load their distinct built-in slots after the imported-model path lands.

8. **RT safety is preserved**
   Imported-profile application must not allocate inside the per-sample or per-block processing loop.

9. **Regression coverage exists**
   Tests must cover parsing/validation, imported-model bridge sync, Neural modal inventory, and DSP distinctness for imported profiles.

## Constraints

- Keep the runtime representation bounded to the current Grinder neural engine instead of inventing a separate external inference engine in this phase.
- Preserve current built-in Neural slot behavior.
- Keep imported profile transport structured and explicit; do not smuggle large opaque blobs through numeric param APIs.
- Persist only serializable data in the patch and browser library.

## Design decisions

### Decision: NAM-first external loading

**Chosen:** ship documented NAM `.nam` import first.

**Rejected:**

- Waiting for simultaneous NAM and AIDA-X support.
  Rejected because it expands scope before one external import path is proven.

### Decision: embed a compact imported profile in the patch

**Chosen:** the active patch stores the selected imported compact profile.

**Rejected:**

- Storing only an imported model id and relying on a local user library at playback time.
  Rejected because it makes project playback depend on external local state and creates wrong-sound failure modes.

### Decision: use structured worklet patch transport

**Chosen:** send imported Neural profiles through a structured Grinder patch payload.

**Rejected:**

- Encoding imported profile data entirely as dozens of unrelated Arrangement device params.
  Rejected because it is brittle and obscures the fact that imported-model loading is a patch-level state change.

## Acceptance criteria

- [x] A parser test proves a valid `.nam` JSON file becomes an imported Grinder neural entry with a compact profile.
- [x] A parser test proves malformed/unsupported `.nam` payloads are rejected.
- [x] A Grinder bridge test proves an imported Neural selection sends a structured custom-profile patch to the audio engine.
- [x] A Grinder panel test proves imported Neural library entries render in the modal.
- [x] A Grinder DSP test proves different imported custom profiles produce different output.
- [x] Built-in Neural slot coverage continues to pass after the imported path lands.
- [x] `cargo test -p daw-dsp grinder::` passes.
- [x] `pnpm test:run src/modules/Grinder` passes.
- [x] `pnpm typecheck` passes.
- [x] `pnpm deps:validate` was rerun for this phase and still fails at the repo-wide baseline rather than from a Grinder-local regression.

## Implementation notes

- Treat imported NAM files as external source material for a compact Grinder profile, not as a promise of full official NAM runtime parity.
- Keep the imported profile portable and small: derived nonlinear-shaping values plus bounded neural-weight data is enough for this phase.
- The reusable imported-model library and the active patch serve different purposes:
  - library: modal reuse and browsing
  - patch: audible project truth
- Restore the reusable library lazily in Grinder UI if needed, but do not let modal hydration timing decide whether the project sounds right.

## Test plan

- [x] Add failing parser tests for valid and invalid `.nam` imports.
- [x] Add a failing Grinder bridge test for imported custom-profile sync.
- [x] Add a failing Grinder panel test for imported Neural library rendering.
- [x] Add a failing Grinder DSP test for imported-profile distinctness.
- [x] Run targeted Vitest and Grinder DSP tests first.
- [x] Run full Grinder validation, then `pnpm deps:validate`, then `pnpm typecheck`.

## Open questions

- [ ] **[MINOR]** Should a later phase persist the original raw `.nam` payload alongside the compact Grinder profile for future export or higher-fidelity reprocessing?

## Tradeoffs and risks

- This phase makes external Neural assets real, but it does not claim full third-party runtime equivalence yet.
- If compact-profile derivation is too conservative, imported models will feel interchangeable; if too aggressive, imports will feel unstable or gimmicky.
- Embedding imported profile data in the patch increases project state size modestly, but it prevents wrong-sound failures caused by missing local library state.
