---
type: spec
id: SPEC-plugin-hosting-clap
title: CLAP-first native plugin hosting
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
  - intake/audit-deferred-fixes.md
---

# CLAP-first native plugin hosting

## Intent

Move native plugin hosting from the custom VST3 wrapper to a CLAP-first architecture
via a safe Rust abstraction, with out-of-process sandboxing so a plugin crash cannot
take down the DAW, real-time-safe SAB audio transport instead of per-block IPC, and a
format-agnostic host trait that can later gain VST3/AU/ARA backends without changing
the cross-module contract.

## Non-goals

- Audio Unit (AU) hosting — explicitly out of scope for v1 (macOS-only, separate runtime glue).
- Device rack composition and modulation matrix (see existing `device-racks`).
- Plugin identity/metadata modeling (see existing `plugin-identity`).
- ARA full integration — only the host-trait flexibility to add it later is in scope.

## Requirements

### AC-001 — CLAP host via a safe Rust abstraction

Native hosting must load and run CLAP plugins through a `clack-host`-style safe
abstraction, replacing the custom VST3 wrapper as the primary path.

Verify with: `pnpm cargo:test -- -p daw-plugin-host clap_host`

### AC-002 — Out-of-process sandboxing

Hosted plugins must run out-of-process such that a plugin crash surfaces an error and
does not terminate the DAW process.

Verify with: `pnpm cargo:test -- -p daw-plugin-host sandbox_crash_isolation`

### AC-003 — SAB audio transport, no per-block IPC

The native plugin bridge worklet must exchange audio via shared-memory ring buffers
and a separate param queue, with zero `tauriInvoke` calls inside `process()`.

Verify with: `pnpm test:run -- nativePluginBridge`

### AC-004 — Format-agnostic host trait

The plugin-host trait must not hard-code a CLAP/VST3-only format enum.

Verify with: `pnpm cargo:test -- -p daw-plugin-host host_trait_extensible`

### AC-005 — Real-time-safe disk streaming for large libraries

Large sample libraries must stream from disk via a real-time-safe path (e.g. `creek`)
rather than full in-memory load.

Verify with: `pnpm cargo:test -- -p daw-plugin-host streaming_load`

### AC-006 — Audio thread elevated to real-time priority

The CPAL audio thread must be promoted to real-time priority on macOS/Linux/Windows,
falling back to default priority with a single warning on failure (never crashing).

Verify with: `pnpm cargo:test -- -p daw-engine audio_thread_priority`

### AC-007 — Adding a backend is a localized change

Adding a third backend variant to the plugin-host trait must be a localized change.

Verify with: `pnpm cargo:test -- -p daw-plugin-host host_trait_extensible`

### AC-008 — No AU crates in the v1 dependency tree

The v1 `daw-plugin-host` build must not pull any Audio-Unit-related crates (e.g.
`coreaudio-sys`, `auv3`) into its dependency tree.

Verify with: `cargo tree -p daw-plugin-host | grep -Ei 'coreaudio-sys|auv3'` returns no matches

### AC-009 — AU recorded as a documented non-goal

The AU-out-of-scope-for-v1 decision and its rationale (AU is macOS-only; CLAP+VST3
already cover the bulk of professional plugin inventories; AU imposes Objective-C
runtime glue, Component Manager lifecycle handling, and AUv3 sandbox plumbing that
do not share implementation with the CLAP/VST3 paths) must be stated in both
`docs/licensing/third-party.md` and `.agents/skills/plugin-hosting/SKILL.md`.

Verify with: `grep -li 'audio unit' docs/licensing/third-party.md .agents/skills/plugin-hosting/SKILL.md`

### AC-010 — Plugin picker does not offer AU as a filter

The plugin picker UI must not surface "AU" as a filterable plugin type in v1.

Verify with: `pnpm test:run -- pluginPicker`

### AC-011 — Native bridge sizes the SAB rings and uses a separate param queue

The native plugin bridge must allocate one shared-memory ring per direction
(input frames, output frames) sized `4 × blockSize` per channel, and route
control-rate parameter updates through a separate lock-free SPSC param queue
(small SAB or `Atomics`-managed Int32 ring) — not the audio rings.

Verify with: `pnpm test:run -- nativePluginBridge`

### AC-012 — Bridge under-run fills zero and counts a glitch

When the output ring has no ready frames, the native bridge worklet `process()`
must fill the output with zero and increment a glitch counter exposed via telemetry
(never block or allocate).

Verify with: `pnpm test:run -- nativePluginBridge`

## Open questions

- [ ] (non-blocking) Whether the Rust-side cpal consumer of the bridge SAB ships in the
  same change as the worklet side, or follows. Default: worklet-side first, Rust consumer follow-up.
  (deferred-gap from intake/audit-deferred-fixes.md, I-01) The Rust side runs a
  cpal-driven loop reading the input SAB and writing the output SAB; block size matches
  the worklet's `process()` frame size; initial implementation latency is `2 × blockSize`
  (one block in each direction) and must be documented. The SAB ring layout must follow
  the same conventions as the recording pipeline (`recording.ts`) so platform-host work
  has one pattern, not two. Rejected alternatives: MessagePort with structured cloning,
  and one-SAB-per-block allocated on demand — both allocate per block and are blocked by
  the RT no-alloc rule.
- [ ] (non-blocking) (deferred-gap from intake/audit-deferred-fixes.md, Group D — Audio
  engine architecture) This bridge's SAB transport (I-01 / AC-003, AC-011, AC-012) is one
  of four engine-architecture fixes that share a substrate but are tracked against the
  audio engine, not this spec. The full Group D scope is:
  **D1 (I-05) `EngineDeviceNode`** — a structural type in
  `src/modules/AudioEngine/engine/contracts/EngineDeviceNode.ts` with
  `{ id, inputNode, outputNode, setParam({param,value,sampleFrame?}), setBypass(bool),
  getLatencySamples(), dispose() }`; each plugin module exports its own
  `create<Plugin>EngineNode(...)`; `TrackNode` holds an `EngineDeviceNode[]` and iterates
  it (no per-plugin branches in `updateParam`/`updateBypass`/`removeDevice`/`dispose`); the
  `unregisterLevainDevice`/`unregisterProofDevice` cross-module imports are removed.
  **D2 (I-19) parameter-only bypass** — each node builds an internal parallel dry/wet
  two-`GainNode` topology; `setBypass(true)` schedules `wet=0, dry=1` and `setBypass(false)`
  the inverse, with `setTargetAtTime` ramps over ~5 ms; `TrackNode.updateBypass` no longer
  calls `rebuildChain()`.
  **D3 (I-06) PDC** — `TrackNode.getCompensationDelaySamples()` sums `getLatencySamples()`
  across the chain; recording offsets the writer pointer by it; automation subtracts the
  offset; a `getProjectPdcMap()` use case returns `Record<TrackId, number>`; latency stays
  runtime-side, never written to project truth.
  **D4 (I-01)** — the native plugin SAB transport this spec implements as AC-003/AC-011/AC-012.
  D1 is the largest refactor and should be done piecewise, one plugin at a time, with
  `pnpm deps:validate` and `pnpm typecheck` green after each migration. Non-blocking here
  because the bridge can deliver its worklet-side SAB path against AC-003 ahead of the
  broader engine refactor.
- [ ] (non-blocking) ARA 2 host integration sequencing — out of v1 scope; confirm the
  trait shape leaves room for it.

## Affected areas

- `crates/daw-plugin-host/` (CLAP host, sandbox, host trait, streaming)
- `crates/daw-engine/` (audio thread priority)
- `src/modules/AudioEngine/` (NativePluginBridgeNode SAB path)
- `docs/licensing/third-party.md` and `.agents/skills/plugin-hosting/SKILL.md` (AU non-goal + rationale, AC-009)
- the plugin-picker UI (AU not offered as a filter type, AC-010)

## Dropped from sources

- AU hosting — kept as an explicit non-goal; the decision, its rationale, and its
  verifiable consequences are folded into AC-008 (no AU crates), AC-009 (documented
  non-goal), AC-010 (no AU filter in the picker), and the existing trait-flexibility
  AC-007 (an AU backend can be added later without changing the cross-module contract).
- The shared `EngineDeviceNode` engine refactor (audit Group D: D1 interface, D2
  parameter-only bypass, D3 PDC) — tracked as a deferred-gap Open question; it is the
  substrate this bridge's SAB transport (D4 / AC-003) implements, not this spec's deliverable.
