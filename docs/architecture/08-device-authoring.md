# Authoring a Built-in Device (Bakery Playbook)

The built-in instruments and effects are the bread-named modules — Fermenter (synth), Toaster (drums), Gluten (compressor), and so on; the root `AGENTS.md` naming key maps all fourteen. Devices share a repeatable anatomy across four surfaces: a TypeScript module, a Rust DSP engine, an AudioEngine node, and a panel registration. This document is the playbook for adding a new one or changing an existing one.

It complements:

- `TypeScript Module Architecture` — module anatomy and contract barrels
- `WASM DSP Pipeline` — how engines reach the worklet
- `crates/daw-dsp/AGENTS.md` + `src/modules/AudioEngine/AGENTS.md` — subtree rules

---

## 1. Anatomy of a device

| Surface | Location | Responsibility |
|---|---|---|
| TS module | `src/modules/<Device>/` | patch state, telemetry, panel UI, use cases |
| Rust engine | `crates/daw-dsp/src/<device>/` | sample-level DSP, dual-compiled native + WASM |
| Engine node | `src/modules/AudioEngine/engine/<Device>Node.ts` | wraps the WASM instance as a graph node |
| Panel wiring | `WorkspaceShell` device panels + `NativeDspDescriptors.ts` | how the UI opens and what parameters exist |

Not every device has every surface. Crust (limiter) has no Rust engine; Yeast (MIDI FX) and CvGate are TS-side; Crumbs' engine is native-only behind `crumbs_*` commands; the Tuner is the `scoring` crate; ProofChamber is its own `proof-chamber` crate. Check the naming key's exceptions before copying a sibling's shape.

## 2. TypeScript module conventions

**Store shape.** Multi-instance devices key state by `deviceId`: `createStore<Record<string, DeviceState>>`. The store is a public read contract — all writes go through the module's own use cases or `executeAppAction`.

**Telemetry split.** Meter data (~60 Hz) must not live in the patch store — rewriting the patch map at meter rate would churn persistence and undo. Follow Gluten: `glutenStore` (patch) vs `glutenMeterStore` (telemetry). Telemetry is a side channel, never truth.

**Styling.** One stylesheet per styled device in `src/styles/utilities/modules/<device>.css`; components come from the shared `src/components/daw/` family (Fader, RotaryKnob, LED, `Daw*` panels, DSP-curve visualizers).

**Naming.** Module PascalCase matching the bakery name; the Rust engine is the snake_case twin (`GrandBoule` ↔ `grand_boule`). Device-panel events use the generic `panel.showDevice`; per-device panel events are deprecated.

## 3. Rust engine conventions

One module per device under `crates/daw-dsp/src/`, with a `#[wasm_bindgen] <Device>Instance` struct unless the device is native-only. The audio path is **allocation-free and lock-free**, enforced by `assert_no_alloc` dev-dependency tests — they are the RT contract, and they fail if you allocate in a `process` path. Code must compile for both native and `wasm32`; gate platform-specific bits with `cfg`.

After changing an engine's WASM surface, rebuild with `pnpm wasm:dsp` (or `wasm:all`) so the worklet glue in `AudioEngine/wasm/` regenerates — never hand-edit generated glue.

## 4. Wiring checklist for a new device

1. TS module with store (patch/telemetry split), use cases, `handlers/` map exported via `get<Device>Handlers()`.
2. Register the handler map in `src/app/bootstrap.ts` — order is pinned by `src/app/__tests__/bootstrap.spec.ts`; update the spec.
3. Rust engine in `crates/daw-dsp/` + `*Instance` export; add to the workspace if new.
4. Engine node in `AudioEngine/engine/` via `wasmDeviceRegistry.ts`; worklet processor using `workletInitShared.ts` for the init handshake.
5. Parameter descriptor in `Arrangement/models/PluginDescriptors/NativeDspDescriptors.ts` so automation and generic inspectors see it.
6. Panel view under the module's `presentations/views` barrel; route through `panel.showDevice`.
7. Stylesheet in `src/styles/utilities/modules/`.
8. Specs: one per source file in `__tests__/`, per `testing-file-layout`.

Skip a step and something degrades silently: no handler map → no undo; no telemetry split → 60 Hz undo churn; no descriptor → invisible to automation; wrong init path → worklet never becomes ready.

## 5. Study these first

- **Gluten** — the cleanest small effect: store split, engine, node, panel.
- **Crumbs** — the native-only exception: full engine behind native commands with a `repositories/crumbsBridge/` mirror.
- **ProofChamber** — the separate-crate exception (reverb as `proof-chamber`, "Dutch Oven" device id).

## References

- Root `AGENTS.md` — device naming key and orientation anchors
- `docs/architecture/07-wasm-dsp-pipeline.md` — build and loading
- `docs/06-testing.md` — spec layout
