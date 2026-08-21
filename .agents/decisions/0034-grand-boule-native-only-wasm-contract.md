---
type: adr
id: 0034
title: Keep Grand Boule native-only at the daw-dsp WASM boundary
status: accepted
date: 2026-08-21
owner: The Sourdaw team
sources:
    - .agents/decisions/0032-withhold-grand-boule-from-release.md
    - crates/daw-dsp/src/grand_boule/mod.rs
    - src/modules/AudioEngine/worklets/grandBouleWasmInstance.ts
    - scripts/checkReleaseInventory.ts
---

# 0034 - Keep Grand Boule native-only at the daw-dsp WASM boundary

## Context

ADR 0032 withholds Grand Boule from released product paths while requiring its complete
implementation and project data to remain intact. Release admission prevents product callers from
selecting the device, but the generated `daw-dsp` JavaScript, declarations, and WebAssembly binary
still exposed a public `GrandBouleInstance` constructor. A distributed constructor is a release
surface even when the product does not call it.

The Rust engine, native host instance, browser host code, workers, worklets, and their focused tests
remain useful retained implementation. Withholding the generated constructor does not require
deleting those sources.

## Decision

Grand Boule remains a complete native `daw-dsp` implementation. `GrandBouleInstance` and its
`wasm_bindgen` implementation compile only when the target architecture is not `wasm32`; the rest of
the Rust module remains available to the crate on both targets.

Generated public and AudioEngine `daw-dsp` JavaScript, declarations, and WebAssembly exports contain
no Grand Boule constructor or Grand Boule instance exports.

The retained TypeScript host stack owns a structural `GrandBouleInstance` interface. Its production
construction seam is inert and imports no generated Grand Boule value or type. Focused host tests
replace that seam with in-memory instances. `deviceReleaseAdmission.ts` remains the primary live and
offline reachability gate.

The release inventory check inspects every generated text surface and the WebAssembly export table.
Any Grand Boule export fails release validation.

## Consequences

- Grand Boule Rust source, native tests, native benches, TypeScript hosts, workers, worklets, and
  project data remain in the repository.
- Distributed `daw-dsp` artifacts cannot construct Grand Boule independently of product admission.
- Host tests exercise the retained transport and control behavior without treating generated WASM
  as an admitted constructor source.
- ADR 0032 continues to govern release admission and evidence requirements.
