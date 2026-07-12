---
type: spec
id: SPEC-browser-dsp-offload
title: Browser DSP offloading and shared-memory config
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Browser DSP offloading and shared-memory config

## Intent

Reduce browser main-thread CPU by routing standard effects through native Web Audio
nodes where the dependency graph allows, enabling `SharedArrayBuffer` via cross-origin
isolation headers, and standing up a SAB-backed ring for UI metering/control updates
that do not need to round-trip through Tauri IPC.

## Non-goals

- Native (desktop) DSP and plugin hosting (see `plugin-hosting-clap`).
- Custom-DSP effects that must remain in WASM.
- The DSP primitives themselves (see `dsp-library-expansion`).

## Requirements

### AC-001 — Standard effects route to native Web Audio nodes

When the dependency graph allows, standard effects (convolver, biquad, compressor)
must run on native Web Audio nodes instead of WASM.

Verify with: `pnpm test:run -- webAudioOffload`

### AC-002 — Measurable main-thread CPU reduction

On the reference project, routing standard effects to native nodes must reduce
main-thread CPU by ≥10% during playback.

Verify with: `pnpm test:run -- webAudioOffloadPerf`

### AC-003 — Cross-origin isolation enabled

COOP/COEP headers must be set in the Tauri config and dev server so
`self.crossOriginIsolated === true` on startup in dev and production.

Verify with: `pnpm test:run -- crossOriginIsolatedStartup`

### AC-004 — SAB-backed metering ring

A SAB ring must deliver audio-worklet meter updates to the React UI at ≥30 Hz without
blocking the main thread more than ~2 ms per frame.

Verify with: `pnpm test:run -- sabMeterRing`

## Open questions

- [ ] (non-blocking) Which standard effects are safe to offload given graph constraints
  (sidechain, feedback) — enumerate during implementation.

## Affected areas

- web audio graph construction (native-node routing)
- `tauri.conf.json` and dev server headers
- audio worklet ↔ UI SAB ring

## Dropped from sources

- None — this spec scopes the §8.3b items directly.
