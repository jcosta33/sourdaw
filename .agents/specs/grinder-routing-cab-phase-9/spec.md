---
type: spec
id: SPEC-grinder-routing-cab-phase-9
title: Grinder routing and cabinet contract — phase 9 (real cabType, cabIrId, routingMode)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Grinder routing and cabinet contract — phase 9 (real cabType, cabIrId, routingMode)

## Intent

Make Grinder's `routingMode`, `cabType`, and `cabIrId` patch fields into real
current-rig controls: changing them updates the live signal path, built-in cabinet
voices can be selected intentionally, and the Cab UI reflects those choices — all inside
the fixed rig architecture, without expanding into the modular graph roadmap.

## Non-goals

- Arbitrary graph routing or split/merge editing.
- User-imported IR asset management.
- Full dual-amp authoring with separate per-branch amp settings.
- Broader later-stage amp retuning.
- AIDA-X or deeper Neural runtime work.

## Requirements

### AC-001 — Cabinet mode is real

`cabType = 'ir' | 'parametric' | 'both'` must change which cabinet stages are rendered in
the live DSP path.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — Cabinet voice is real

`cabIrId` must select a real built-in cabinet IR voice rather than sitting unused in the
patch model.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-003 — Routing preset is real

`routingMode = 'serial' | 'parallel' | 'wet-dry-wet' | 'dual-amp'` must select distinct
bounded signal-path behaviors inside the current Grinder engine.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-004 — Patch-to-audio sync is complete for this slice

Full patch loads must sync `cabType`, `cabIrId`, and `routingMode` to the live engine.

Verify with: `pnpm test:run -- grinderParamBridge`

### AC-005 — Cab UI reflects the contract

The Cab section must expose user-facing controls for cabinet voice, cabinet mode, and
route preset.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-006 — Phase 4 cabinet mic/room behavior is preserved

The cabinet mic distance and room behavior added in phase 4 must continue to work after
the routing/cab selections land.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

## Open questions

- [ ] (non-blocking) Should a later phase rename `routingMode` to something more
  explicitly preset-like if the graph project stays deferred for long?

## Affected areas

- `crates/daw-dsp/src/grinder/engine.rs`
- `crates/daw-dsp/src/grinder/cabinet.rs`
- `src/modules/Grinder/models/GrinderPatch.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`

## Dropped from sources

- Leaving `routingMode` as metadata until the graph project exists — rejected; delivery
  was requested over placeholder marking, so routing modes ship as bounded rig presets.
- User IR asset loading — deferred; it expands into file management, persistence,
  validation, and asset lifecycle. `cabIrId` maps to built-in voices first.
- Fully independent editable dual-amp branches — out of scope; `dual-amp` is a derived
  second lane within the fixed chain.
