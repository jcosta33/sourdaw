---
name: device-authoring
description: >-
    Author and change built-in devices (instruments and effects) across every layer
    they touch: descriptor, parameter law, Rust DSP, wasm package, engine node,
    worklet processor, offline render, panel. ALWAYS apply when adding a built-in
    device or changing a device's parameters, DSP, processor, descriptor, engine
    node or panel — even a single new parameter. Skip third-party plugin hosting
    (plugin-hosting), routing and transport work (web-audio-engine), and UI-only
    restyling (ui-patterns).
---

## Purpose

A built-in device is one identity spread over a descriptor, a Rust engine, an engine node, a worklet processor, an offline path and a panel. A change that reaches only some layers ships a control that looks alive and is not. Long-form anatomy and wiring order: [docs/architecture/08-device-authoring.md](../../../docs/architecture/08-device-authoring.md); wasm build and loading: [docs/architecture/07-wasm-dsp-pipeline.md](../../../docs/architecture/07-wasm-dsp-pipeline.md). This skill holds the rules and the traps; it does not repeat them.

## Touch map

| Concern                                         | Path                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Descriptor (one per device) and its guidance    | `src/modules/Arrangement/models/PluginDescriptors/<Device>Descriptor.ts`                                                  |
| Register the descriptor                         | add it to `BUILTIN_PLUGINS` in `src/modules/Arrangement/models/DeviceParameter.ts`                                        |
| Device type id                                  | `NATIVE_DSP_DEVICE_TYPES` and `DEVICE_TYPE_IDS` in `src/utils/nativeDspDeviceTypes.ts`                                    |
| Parameter law (range, quantise, automatable)    | `src/modules/Arrangement/models/DeviceParameterLaw.ts`                                                                    |
| Parameter write boundary                        | `src/modules/Arrangement/stores/clampDeviceParamWrite.ts`, `persistDeviceParam.ts`                                        |
| Rust DSP                                        | `crates/daw-dsp/src/<device>/` (reverb: `crates/proof-chamber`, tuner: `crates/scoring`)                                  |
| wasm package and build script                   | `scripts/wasm-artifacts.ts`; generated glue in `src/modules/AudioEngine/wasm/`                                            |
| Engine node and init handshake                  | `src/modules/AudioEngine/engine/<Device>Node.ts` via `src/infra/audioWorklet/workletInitShared.ts`                        |
| Engine parameter names, where not camelCase     | `src/modules/AudioEngine/models/<Device>*ParamNames.ts`                                                                   |
| Node registration                               | `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts`                                                                    |
| Worklet processor                               | `src/modules/AudioEngine/worklets/<device>Processor.ts`                                                                   |
| Offline render                                  | `src/modules/AudioEngine/repositories/deviceStrategy/` (`nativeDspDeviceFactories.ts`, `setupDeviceStrategies.ts`)        |
| Offline project hydration                       | `OFFLINE_DEVICE_HYDRATION` in `src/app/prepareOfflineDeviceSetup.ts`                                                      |
| Panel                                           | the device module's `presentations/views` barrel, mounted by `WorkspaceShell/presentations/hooks/useActiveDevicePanel.ts` |
| Panel gate                                      | `PANELLED_DEVICE_TYPES` in `src/modules/WorkspaceShell/useCases/panels/devicePanels/showDevicePanelForType.ts`            |
| Stylesheet                                      | `src/styles/utilities/modules/<device>.css`                                                                               |
| Handler map, only if the device owns AppActions | `src/app/getProductionCommandHandlerMaps.ts`                                                                              |

## Core rules

### 1. One parameter identity end to end

The descriptor parameter id, the engine parameter name, the processor translation (`PARAM_MAP` table or `camelToSnake`) and the Rust `set_param` arm must agree. A name the engine does not answer is dropped silently by its catch-all arm, yet stays automatable and persists into the project.

**Why:** every layer forwards a parameter name verbatim, so the mismatch surfaces nowhere.

**Enforced by:** `src/modules/Arrangement/models/PluginDescriptors/__tests__/descriptorEngineParamWeld.spec.ts` (reads descriptors, processor translation and Rust arms from the shipped files), `nativeDspDeviceTypeWeld.spec.ts` in `repositories/deviceStrategy/__tests__/` for device types. Fill the device's row in the weld's `PARAM_NAME_TRANSLATIONS` (keyed by device type; the compiler demands the row): the processor's translation and, where the engine names differ, its `*ParamNames.ts` table.

### 2. Every exposed control does something

Never ship a label, knob or automatable parameter without its DSP. If the DSP is missing, write it; do not drop the control, fake it, or approximate it.

**Why:** a dead control consumes an automation lane and survives save and reload.

**Enforced by:** rule 1's weld for the wiring; review only for the sound.

### 3. Parameter writes go through the law and the action path

A write is clamped and quantised by the descriptor's declared law (`clampDeviceParameterValue`, `quantiseDeviceParameterValue`, `isDeviceParameterAutomatable` in `DeviceParameterLaw.ts`), reaches the project through `clampDeviceParamWrite` and `persistDeviceParam`, and mutating actions go through `executeAppAction`. Never write the store or the document directly.

**Why:** the law is the only place a declared range or automatable flag has effect; a side door bypasses both and undo.

**Enforced by:** `src/modules/Arrangement/stores/__tests__/deviceWriteBoundaryClosure.spec.ts` catches a new write sink (a per-file census; a new sink moves a count, restate the row with its provenance). Clamping and quantising on an existing path is review only.

### 4. Processors stay real-time safe and isolated

No allocation, locks or blocking on the audio thread. A processor imports nothing from `useCases`, `repositories`, `stores`, `services`, `engine`, `workers`, `presentations`, `src/helpers/` or the desktop bridge. Wasm is instantiated through the structured-cloned module the engine node hands over; the processor compiles nothing.

**Why:** a missed deadline is an audible dropout, and worklet scope has no app runtime.

**Enforced by:** dependency-cruiser `worklets-no-module-runtime-imports` and `worklets-no-app-helper-or-desktop-ipc` (`.dependency-cruiser.cjs`, match `src/modules/<M>/worklets/**` only); `crates/daw-dsp/tests/device_process_rt.rs` for the Rust render path, which guards only the devices it lists: add the new device there, driven into a configured, audible state (see `crates/daw-dsp/AGENTS.md`). Review only for TypeScript allocation.

### 5. Live and offline agree

Every catalog device needs an offline render path, built from project truth rather than live node state. A change to DSP, defaults or parameter translation changes both paths or neither.

**Why:** an export that sounds different from playback is a defect in the product's central promise.

**Enforced by:** `repositories/deviceStrategy/__tests__/offlineDeviceCoverage.spec.ts` (every catalog id has a strategy), `nativeDspDeviceTypeWeld.spec.ts`; parity specs such as `repositories/offlineScheduler/__tests__/fermenterOscWaveformOfflineParity.spec.ts` and `useCases/offlineRender/__tests__/drumKitRenderParity.spec.ts` set the pattern for a new device. Numeric parity of a new device is review only until it has its own spec.

### 6. The panel proves it reaches the engine

A panel control must write to the object that renders audio, not to a mirror of it.

**Why:** a panel can pass its own tests and move nothing.

**Enforced by:** `src/modules/AudioEngine/engine/__tests__/panelReachesTheEngine.spec.tsx`, for the device types in its `COVERED_DEVICE_TYPES` only. A new panelled device joins that list, or records in `NOT_COVERED_DEVICE_TYPES` why the spec cannot drive it; an uncovered panel is review only. A device missing from `PANELLED_DEVICE_TYPES` never opens its panel.

### 7. Generated and pinned artifacts move with the change

Settle these in the lane before publishing, per [AGENTS.md Delivery](../../../AGENTS.md#delivery) and [delivery-orchestration "Before publishing"](../delivery-orchestration/SKILL.md):

- **wasm:** any non-test edit in a package's Rust dependency closure, a comment included, changes its hash. Take the package and script from `scripts/wasm-artifacts.ts` (`wasm:dsp`, `wasm:proof-chamber`, `wasm:scoring`, `wasm:decoder`), rebuild that package, run `pnpm wasm:manifest`, stage, then `pnpm wasm:verify`. Never hand-edit `src/modules/AudioEngine/wasm/`.
- **Descriptor or guidance text:** moves the capability inventory digest pinned in `evidence/agent-campaign/manifest.json` (checked by `src/app/__tests__/agentCampaignBaseline.spec.ts`). The same manifest pins whole source trees such as `crates/daw-engine/src`, so a comment edit there moves it too. List stale digests with `pnpm evidence:gate --manifest evidence/agent-campaign/manifest.json`, rewrite with `--write`, commit. It also changes the device's `descriptor-v1:` fingerprint pinned in `BASELINE_DESCRIPTOR_VERSION_PINS` in `src/modules/Arrangement/useCases/__tests__/getDeviceContractVersionForCommand.spec.ts`. Guidance must fit the per-page receipt budget in `src/modules/AiRuntime/useCases/__tests__/deviceManifestPaging.spec.ts`: cut wording, never the budget.
- **Release tracked set:** a committed change to a path in `GRAND_BOULE_RELEASE_REGISTRY` (`scripts/checkReleaseInventory.ts`) needs `pnpm release:restamp:tracked-set`, which rewrites `release/open-source-inventory.json`.
- **Handler map:** a new map is registered in `src/app/bootstrap.ts` and assembled in `src/app/getProductionCommandHandlerMaps.ts`; `src/app/__tests__/bootstrap.spec.ts` pins the registration order, so update it. A device without AppActions of its own gets no map.

**Why:** each is a pin on content, not on the changed paths, so "I touched nothing pinned" is not evidence.

**Enforced by:** PR CI (wasm freshness, release inventory, the specs above). Run the exact affected specs locally under `pnpm guard`; leave broad suites to CI.

## References

- [docs/architecture/08-device-authoring.md](../../../docs/architecture/08-device-authoring.md), [docs/architecture/07-wasm-dsp-pipeline.md](../../../docs/architecture/07-wasm-dsp-pipeline.md)
- [src/modules/AudioEngine/AGENTS.md](../../../src/modules/AudioEngine/AGENTS.md), [src/modules/Arrangement/AGENTS.md](../../../src/modules/Arrangement/AGENTS.md), `crates/daw-dsp/AGENTS.md`
- Related skills: `web-audio-engine`, `plugin-hosting`, `ui-patterns`, `testing-file-layout`
