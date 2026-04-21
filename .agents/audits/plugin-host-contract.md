---
name: plugin-host-contract
description: TrackNode hardcodes per-plugin branches — needs a uniform DeviceNode interface. Also covers Crust silent-add and plugin store singletons.
type: audit
status: open
last_verified: '2026-04-20'
---

# Plugin Host Contract & Device Lifecycle

## Scope

Plugin instantiation, parameter routing, bypass, disposal, and state management across all device types. Covers I-05, I-19, I-01, I-06, N-18, N-30, S-04 from the original consolidated audit.

## Goal

A uniform `DeviceController` interface that every plugin implements. TrackNode delegates to the interface instead of branching per device type. Plugin state is per-instance, not singleton.

## Relevant code paths

- `src/modules/AudioEngine/engine/TrackNode.ts` — 567 LOC with 4-6 device-specific branches per method
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts` — WASM device matchers
- `src/modules/AudioEngine/repositories/deviceStrategy/setupDeviceStrategies.ts` — device factory registry
- `src/modules/Toaster/stores/toasterStore.ts` — singleton store
- `src/modules/Levain/stores/levainStore.ts` — singleton store
- `src/modules/Fermenter/stores/fermenterStore.ts` — per-device (correct pattern)
- `src/modules/Crust/` — full UI, no DSP
- `src/modules/AudioEngine/engine/{GrinderNode,BacteriaNode,GlutenNode,FermenterNode}.ts` — per-plugin node classes with `destroy()` methods

## Current behavior

**TrackNode branches per device type in 4 methods:**

- `removeDevice()` (lines 383-414): 6 branches — fermenter, toaster, levain, grandBoule, wam, proof.
- `updateParam()` (lines 416-463): 5-6 branches — wam, builtin-sidechain, fermenter, toaster, levain, nativeDsp/DEVICE_FACTORIES fallback.
- `scheduleParam()` (lines 474-504): 3 branches — wam, faust- prefix, fermenter.
- `updateBypass()` (lines 506-523): 4 branches — fermenter, toaster, levain, nativeDsp, then fallback `rebuildChain()`.

Every new plugin type adds branches to all 4 methods + 2 cross-module imports at the top of the file.

## Findings

- **All WASM plugin nodes already have `destroy()`.** GrinderNode:141, BacteriaNode:122, GlutenNode:116, FermenterNode:111 all implement cleanup. The problem is that TrackNode.dispose() doesn't call all of them uniformly.
- **Toaster and Levain are singletons.** Toaster (toasterStore.ts:38-40) and Levain (levainStore.ts:43-45) both use a single global state object. Fermenter is correctly per-device (keyed by deviceId). Adding a second instance of Toaster or Levain collides.
- **Crust has no DSP.** Full front-end stack exists but no engine-side node, worklet, or Faust module. `findWasmDescriptor('crust')` returns undefined → silent `return` in TrackNode.addDevice (~311-312). User sees knobs that do nothing.
- **NativePluginBridge (I-01)** uses per-block `tauriInvoke` for audio processing — architectural ceiling, needs SAB transport.
- **PDC (I-06) is partially wired.** `get_latency_samples()` IS called in worklet processors (grinderProcessor.ts:232, bacteriaProcessor.ts:124, glutenProcessor.ts:150, proofProcessor.ts:128) and written to SAB views. But **no host-level code reads these values or compensates recording/automation**. Latency is reported but not acted on.

## Open issues

### 1. TrackNode hardcoded plugin branches (I-05 / I-19)

**Problem:** 567-line file with growing per-plugin branches.

**Needed:** Define a `DeviceController` interface:

```
interface DeviceController {
    setParam(name: string, value: number, sampleFrame?: number): void;
    scheduleParam(name: string, value: number, time: number): void;
    setBypass(state: boolean): void;
    destroy(): void;
}
```

Each plugin node class implements this. TrackNode stores `dn.controller: DeviceController` and delegates to it — one code path for all devices.

### 2. Toaster and Levain singletons (N-18 / I-03)

**Problem:** `toasterStore` (toasterStore.ts:38-40) and `levainStore` (levainStore.ts:43-45) both use a single global state. Multi-instance collision for both.

**Needed:** Restructure both to `Record<string, XState>` keyed by deviceId. Add `deviceId` parameter to all accessors. Same pattern Fermenter already uses.

### 3. Crust silent-add (S-04)

**Problem:** No DSP implementation. Adding Crust produces no audio effect and no error.

**Needed:** Either implement DSP (Faust or Rust/WASM — pure Web Audio insufficient for true-peak/lookahead/oversampling) or surface a `PluginNotImplementedError` + toast.

### 4. Plugin device unregister hooks (N-30)

**Problem:** Grinder, Bacteria, Gluten, Fermenter nodes have `destroy()` methods but they're only called if TrackNode explicitly branches to them. With a `DeviceController` interface, `destroy()` would be called uniformly.

**Resolved by I-05 fix.** Once DeviceController exists, `dispose()` just calls `dn.controller.destroy()`.

### 5. Native plugin transport (I-01)

**Problem:** Per-block `tauriInvoke('process_plugin_audio')` in NativePluginBridgeNode:51.

**Needed:** SharedArrayBuffer ring between worklet and Rust cpal thread. Separate spec.

### 6. PDC latency host-side consumption (I-06)

**Problem:** `get_latency_samples()` IS reported to SAB by worklets, but no host-level code reads these values.

**Needed:** Host-wide PDC bus that reads SAB latency views, sums across the chain, compensates recording + automation.

## Suggested approaches

1. **DeviceController interface first.** Define it, implement on one plugin (Fermenter — simplest), migrate TrackNode to use it for that one plugin, then roll out to the rest.
2. **Toaster/Levain singleton fix can ship independently.** Same mechanical refactor as Fermenter's existing pattern.
3. **Crust interim:** Move `CRUST_DESCRIPTOR` out of `BUILTIN_PLUGINS` or register `PluginNotImplementedError`. Proper DSP is a separate initiative.

## Recommendation

Start with the DeviceController interface (I-05) — it unblocks N-30 (uniform cleanup), simplifies I-19 (bypass), and reduces the surface for future plugin additions. Toaster/Levain singleton fix (N-18 / I-03) can be done in parallel.
