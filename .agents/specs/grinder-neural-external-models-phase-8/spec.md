---
type: spec
id: SPEC-grinder-neural-external-models-phase-8
title: Grinder neural external models — phase 8 (NAM import, portable patches)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
  - ../grinder-neural-builtins-phase-7/research.md
---

# Grinder neural external models — phase 8 (NAM import, portable patches)

## Intent

Let the Neural modal import documented NAM `.nam` capture files, keep them in a reusable
imported library, and apply the selected imported capture as a real live DSP profile.
The active patch embeds the compact derived profile so project playback stays portable
regardless of modal-library restore timing.

## Non-goals

- Full NAM reference-fidelity runtime parity.
- AIDA-X import.
- External IR/cab import.
- Routing-mode completion.
- Cloud/library sync or project-bundle asset export.
- Imported-model editing/tagging/deletion beyond basic listing and selecting.
- A separate external inference engine: the runtime representation must stay bounded to the
  current Grinder neural engine in this phase rather than inventing a new external runtime
  (rationale in phase-7 research R-002).

## Requirements

### AC-001 — The Neural modal imports real external model assets

Users must be able to import one or more local `.nam` files from the Neural modal.

Verify with: `pnpm test:run -- parseGrinderNamFile`

### AC-002 — Imports are validated

Malformed JSON, missing required NAM structure, or empty/invalid weight payloads must be
rejected with a visible error state rather than crashing or silently succeeding.

Verify with: `pnpm test:run -- parseGrinderNamFile`

### AC-003 — Imported selections are project-portable

When an imported model is selected, its compact derived profile must be written into the
Grinder patch so the live sound does not depend solely on the reusable library being
restored first.

Verify with: `pnpm test:run -- grinderParamBridge`

### AC-004 — Imported models reach the live DSP

When an imported model is selected, a structured custom-profile payload must be sent
through the browser audio engine into the Grinder worklet/Rust neural path.

Verify with: `pnpm test:run -- grinderParamBridge`

### AC-005 — Imported profiles sound distinct

Different imported profiles must produce measurably different DSP output for the same
input stimulus.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-006 — Imported entries are reusable

Successfully imported models must persist in a Grinder-local library so the modal can
show them again after a reload.

Verify with: `pnpm test:run -- neuralLibraryPersistence`

### AC-007 — Built-in models keep working

Factory Neural library entries must continue to load their distinct built-in slots after
the imported-model path lands.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-008 — RT safety is preserved

Imported-profile application must not allocate inside the per-sample or per-block
processing loop.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-009 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-010 — Patch and library hold only serializable data

Only serializable data must be persisted in the Grinder patch and the browser imported-model
library.

Verify with: `pnpm test:run -- neuralLibraryPersistence`

### AC-011 — Imported profiles never travel as opaque numeric-param blobs

Imported profile transport must stay structured and explicit; large opaque blobs must not be
smuggled through numeric param APIs.

Verify with: `pnpm test:run -- grinderParamBridge`

### AC-012 — Regression coverage exists

Tests must cover parsing/validation, imported-model bridge sync, Neural modal inventory, and
DSP distinctness for imported profiles.

Verify with: `pnpm test:run -- src/modules/Grinder && cargo test -p daw-dsp grinder::`

### AC-013 — Imported entries render in the modal with real metadata

Imported Neural library entries must render in the Neural modal alongside factory entries
and show their real imported metadata rather than placeholder text.

Verify with: `pnpm test:run -- GrinderPanel`

## Open questions

- [ ] (non-blocking) Should a later phase persist the original raw `.nam` payload
  alongside the compact profile for export or higher-fidelity reprocessing? (taken up in
  phase 14)

## Affected areas

- `src/modules/Grinder/useCases/parseGrinderNamFile.ts`
- `src/modules/Grinder/repositories/neuralLibraryPersistence/`
- `src/modules/Grinder/models/GrinderPatch.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`
- `crates/daw-dsp/src/grinder/neural.rs`

## Dropped from sources

- Simultaneous NAM and AIDA-X support — rejected; ship one proven external path first.
- Storing only an imported model id with library-time resolution — rejected; it makes
  playback depend on external local state and creates wrong-sound failure modes.
- Encoding imported profile data as dozens of unrelated Arrangement device params —
  rejected; it is brittle and obscures a patch-level state change.
