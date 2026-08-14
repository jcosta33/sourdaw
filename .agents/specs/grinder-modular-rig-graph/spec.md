---
type: spec
id: SPEC-grinder-modular-rig-graph
title: Grinder modular rig graph (versioned DAG rig editor)
status: draft
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Grinder modular rig graph (versioned DAG rig editor)

## Intent

Evolve Grinder from a fixed amp chain into a true modular guitar rig: users build,
reorder, split, merge, snapshot, and macro-control rigs made of pedals, amps, cabinets,
captures, and utility blocks, while the audio thread stays real-time safe and old
Grinder patches still load as equivalent starter rigs.

## Non-goals

- Hosting arbitrary third-party plugins inside Grinder.
- A generic patch-cable environment for the whole DAW.
- Feedback loops or arbitrary cyclic graphs in v1.
- Shipping every effect category Guitar Rig has offered.
- Reworking other plugin modules to use the Grinder graph model.
- Broader high-gain voicing work outside the graph/control architecture.
- Destructive rename/move of existing Grinder files unless a later spec calls for it.

## Requirements

### AC-001 — Graph-based patch contract

Grinder must store its rig as a versioned graph model with explicit node/edge identities
rather than only `prePedals` and `postPedals`.

Verify with: `pnpm test:run -- GrinderPatch`

### AC-002 — Backward-compatible migration

Every existing Grinder patch and factory preset must migrate to a graph-based rig
automatically and preserve equivalent audible block order and enabled states.

Verify with: `pnpm test:run -- GrinderPatch`

### AC-003 — Real-time-safe graph compilation

Editable graph state must not be traversed on the audio thread; it must be compiled on a
non-RT path into a deterministic execution plan that is atomically swapped into the DSP
engine.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-004 — Deterministic acyclic routing

The graph must be a directed acyclic graph with one input root and one output root.

Verify with: `pnpm test:run -- grinderRigGraph`

### AC-005 — Graph-aware bridge

Dynamic block identity and ordering must reach the DSP engine through a graph-aware
load/update path, without relying on hardcoded `preX` / `postX` parameter names.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-006 — Modular rig blocks

The graph must support the v1 block families: `input`, `gate`, `compressor`,
`overdrive`, `distortion`, `fuzz`, `eq`, `amp`, `cab`, `ir-loader`, `neural-capture`,
`gain`, `split`, `merge`, `output`.

Verify with: `pnpm test:run -- grinderRigGraph`

### AC-007 — Block operations

The rig editor must support create, reorder, duplicate, delete, bypass, solo, rename, and
move-between-lanes operations for blocks through dedicated Grinder use cases.

Verify with: `pnpm test:run -- grinderRigGraph`

### AC-008 — Parallel lanes

Users must be able to create at least one split into two parallel lanes, place different
blocks in each lane, and merge them back together with per-lane level/pan controls.

Verify with: `pnpm test:run -- grinderRigGraph`

### AC-009 — Dual-amp rigs

Users must be able to run two independent amp/cab or amp/capture branches in parallel and
blend them before output, audibly differing from a single-amp equivalent.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-010 — Macros

A rig must expose 8 user-assignable macros, where one macro can drive multiple block
parameters with independent min/max ranges and polarity.

Verify with: `pnpm test:run -- grinderRigGraph`

### AC-011 — Snapshots

A rig must support at least 8 named snapshots that store block bypass states, macro
values, and parameter overrides without duplicating the full rig graph structure.

Verify with: `pnpm test:run -- grinderRigGraph`

### AC-012 — Progressive disclosure

Grinder's UI must retain the repo's Play / Shape / Build / Route / Lab disclosure model
for the modular editor.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-013 — Honest UI contract

Every visible routing control in Grinder must correspond to real graph/DSP behavior; no
decorative routing metadata may remain once this ships.

Verify with: `manual` — inspect each visible routing control and confirm it maps to a real compiled-plan behavior

### AC-014 — Architecture compliance

The implementation must remain inside established module boundaries.

Verify with: `pnpm deps:validate`

### AC-015 — Graph validation rejects invalid routing

Validation must reject cyclic graphs and graphs missing input/output roots.

Verify with: `pnpm test:run -- grinderRigGraph`

### AC-016 — RT-safe graph swap and execution

The graph swap and graph execution path must not use mutexes, blocking waits, or heap
allocation on the audio thread. The DSP engine must rebuild execution order on parameter
or graph change (on the non-RT compile path), not per sample. This is a hard RT-safety
constraint (CLAUDE.md: RT-audio code must not allocate or block) and binds the atomic
swap described in AC-003.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-017 — Single logical graph contract across worklet and native paths

The browser/worklet path and the Tauri/native path must use the same logical graph
contract even if the transport differs; both must reach the DSP engine through the same
graph-aware load/update contract described in AC-005, not divergent per-platform shapes.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-018 — Graph truth lives in Grinder stores and use cases

The rig graph must reuse Vanilla stores and existing store/use-case patterns; the
implementation must not introduce Zustand, Redux, or ad-hoc component-local graph truth.
Graph truth must live in Grinder stores/use cases, not in component-local state.

Verify with: `pnpm deps:validate`

### AC-019 — Prefer existing drag/pointer interaction patterns

The rig editor should prefer existing native drag/pointer interaction patterns already
used in the repo over introducing a new drag/drop framework, unless implementation proves
that existing patterns cannot support the rig editor cleanly.

Verify with: `manual` — confirm the rig editor reuses existing repo drag/pointer patterns or documents why they were insufficient

## Constraints

- Keep the work inside the `Grinder` module unless a truly shared primitive is
  demonstrably reused by another module.
- Reuse Vanilla stores and existing store/use-case patterns; do not introduce Zustand,
  Redux, or ad-hoc component-local graph truth. (See AC-018.)
- Do not traverse or mutate the editable graph on the audio thread. (See AC-003.)
- Do not use mutexes, blocking waits, or heap allocation on the audio thread for graph
  swap or graph execution; rebuild execution order on the non-RT compile path on
  parameter/graph change, not per sample. (See AC-016.)
- The browser/worklet path and the Tauri/native path must use the same logical graph
  contract even if transport differs. (See AC-017.)
- Preserve existing Grinder presets and user projects via migration. (See AC-002.)
- Prefer existing native drag/pointer interaction patterns already used in the repo over
  introducing a new drag/drop framework unless implementation proves that existing
  patterns cannot support the rig editor cleanly. (See AC-019.)

## Open questions

- [ ] (non-blocking) Should v1 macros expose only knob-style controls, or also
  footswitch-style boolean assignments for live rig toggles?
- [ ] (non-blocking) Should snapshots support smooth morphing between values in v1, or
  only instant recall?
- [ ] (non-blocking) Should the first implementation cap rigs at a fixed complexity
  budget (e.g. 32 blocks / 2 split regions / 2 amp branches)?
- [ ] (non-blocking) Do we want an FX-loop/send-return block in v1, or is split/merge
  enough for the first modular release?

## Affected areas

- `src/modules/Grinder/models/GrinderPatch.ts`
- `src/modules/Grinder/stores/grinderStore.ts`
- `src/modules/Grinder/useCases/` (rig block add/remove/move/duplicate/connect/compile)
- `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`
- `src/modules/AudioEngine/services/grinderProcessor.ts`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`
- `crates/daw-dsp/src/grinder/engine.rs`

## Dropped from sources

- Extending the `prePedals` / `postPedals` arrays with more slot types — rejected; it
  hardcodes topology and keeps routing as special cases instead of first-class data.
- Keeping fixed slots and graph as equal runtime truths — rejected; dual truth guarantees
  desync bugs and permanent maintenance burden.
- A fully arbitrary cable graph with cycles/feedback — rejected; harder to validate and
  make RT-safe, and broader than the product need (v1 is a DAG with split/merge).
- Embedding arbitrary first-party/third-party plugins from day one — rejected; that turns
  the feature into a plugin-host project. v1 blocks are Grinder-native plus an extension
  seam.
- Decorative survival of `routingMode` — its behaviors become real graph presets or are
  removed.
