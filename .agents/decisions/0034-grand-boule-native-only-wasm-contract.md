---
type: adr
id: 0034
title: Keep Grand Boule native-only at the daw-dsp WASM boundary
status: superseded by 0036
date: 2026-08-21
owner: The Sourdaw team
sources:
    - .agents/decisions/0032-withhold-grand-boule-from-release.md
    - crates/daw-dsp/src/lib.rs
    - crates/daw-dsp/src/grand_boule/mod.rs
    - crates/daw-dsp/benches/wasm/deviceRecipes.js
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

Grand Boule remains a complete native `daw-dsp` implementation. The `grand_boule` module declaration
in `lib.rs` compiles only when the target architecture is not `wasm32`. Native source, instance,
tests, and benches remain intact; no Grand Boule Rust implementation enters the WASM crate graph.

Generated public and AudioEngine `daw-dsp` JavaScript, declarations, and WebAssembly exports contain
no Grand Boule constructor or Grand Boule instance exports.

The retained TypeScript host stack owns a structural `GrandBouleInstance` interface. Its production
construction seam is inert and imports no generated Grand Boule value or type. Focused host tests
replace that seam with in-memory instances. `deviceReleaseAdmission.ts` remains the primary live and
offline reachability gate.

The committed WASM package registry is authoritative for package ids, crate roots, public artifact
paths, and AudioEngine mirror paths. The release inventory check compares the manifest to that
registry, recursively censuses the complete `public/wasm` tree and declared AudioEngine mirrors,
allows only the manifest itself as a public non-artifact control file, and rejects every missing or
unexpected sidecar. It scans every declared text artifact and every declared WebAssembly export
table. Any Grand Boule surface fails release validation.

One Grand Boule preservation registry owns the stable release metadata, inventory paths, and hash
boundaries. It binds the native Rust module, Grand Boule product module, product descriptor,
release-admission gate, node host, ring protocol, Worker host, and the exact `grandBoule*.ts`
worklet set. Inventory validation fails when any boundary is deleted or its tracked bytes change.

The browser-WASM cost benchmark imports and constructs only exported WASM instances. Grand Boule
DSP remains native-only benchmark evidence; the browser benchmark retains only the host
ring-consumer row, reproduces the successful consumer branch atomics, and makes no Grand Boule DSP
timing claim.

## Consequences

- Grand Boule Rust source, native tests, native benches, TypeScript hosts, workers, worklets, product
  schema, and project data remain in the repository.
- Distributed `daw-dsp` artifacts cannot construct Grand Boule independently of product admission.
- Host tests exercise the retained transport and control behavior without treating generated WASM
  as an admitted constructor source.
- ADR 0032 continues to govern release admission and evidence requirements.
