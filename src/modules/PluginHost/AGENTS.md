# PluginHost module — Agent Guidelines

Third-party plugin hosting runtime: manages native plugin discovery (VST3, CLAP, AU), desktop IPC bridge, and Faust dynamic DSP JIT compiler.

## Domain Ownership

Owns third-party native audio plugin lifecycle (VST3, CLAP, AU scanning, loading/unloading, native GUI window management, parameter/preset synchronization) and the Faust dynamic DSP JIT compiler. Does not own WebAudio graph nodes or track channel strips (AudioEngine), or device chain models in the arrangement (Arrangement).

## Public Contract Surface

- **`useCases`**:
    - **Plugin lifecycle & bridge**: `loadPlugin`, `unloadPlugin`, `openPluginGui`, `setPluginParameter`, `setPluginBypass`, `readPluginState`, `restorePluginState`, `activateExternalPlugin`, `clearLoadedExternalPlugins`, `refreshExternalPluginParameters`.
    - **Scanning & discovery**: `findPluginByName`, `findSupportedPlugin`, `SUPPORTED_PLUGIN_FORMATS`, `isSupportedPluginFormat`, `getExternalPluginContractVersionForCommand`, `getAgentDeviceFactoryManifest`, `startPluginScan`, `addScanPath`, `removeScanPath`.
    - **Faust DSP**: `registerBuiltinFaustDSP`, `registerFaustDSP`, `compileFaustDSP`, `createFaustNode`, `isFaustModule`, `getFaustModuleLatencyMs`, `isFaustInstrumentModule`.
    - **Handler maps**: `getPluginHostHandlers`.
- **`stores`**: `pluginScanStore` (`defaultPluginScanState`, type `PluginScanState`), `externalPluginActivationStore` (`defaultExternalPluginActivationState`, types `ExternalPluginActivationState`, `ExternalPluginActivationStatus`), `externalPluginParameterStore` (`defaultExternalPluginParameterState`, types `ExternalPluginParameter`, `ExternalPluginParameterSnapshot`, `ExternalPluginParameterState`) — read-only outside the module: its writers stay off the barrel.
- **`events`**: None.
- **`presentations/views`**: None.
- **Handler maps**: `getPluginHostHandlers` (`handleScanPlugins`).

## Key Subsystems

- **`repositories/pluginBridge/`**: Desktop IPC bridge for native plugin host processes (`scanPlugins.ts`, `loadPlugin.ts`, `unloadPlugin.ts`, `openPluginGui.ts`, `closePluginGui.ts`, `setPluginParameter.ts`, `setPluginBypass.ts`, `getPluginState.ts`, `setPluginState.ts`, `onPluginLatencyChanged.ts`).
- **`stores/`**: `pluginScanStore.ts` (discovered plugins, scan paths, progress), `externalPluginActivationStore.ts` (activation status and loaded instances).
- **`useCases/faustEngine/`**: Dynamic Faust DSP WebAssembly compiler and builtin effects (`compileFaustDSP.ts`, `builtinDSP.ts`).

## Invariants & Traps

- **Native scan root security**: Plugin scanner enforces strict platform scan roots (macOS, Windows, Linux default directories). Custom roots require native authorization; symlinks and symlinked ancestor directories are rejected to prevent path traversal.
- **No leaked native handles**: Raw library handles, plugin pointers, and OS window handles stay behind the native desktop boundary; only serializable DTOs and instance IDs cross IPC.
- **Faust synchronization**: Faust is wired in PluginHost and AudioEngine; updates to Faust DSP types or node interfaces must remain synchronized across both modules.
- **External plugins are engine-hosted**: the native engine processes a hosted plugin inline on its own audio callback. No command carries per-block audio across the desktop IPC boundary, and the Web Audio graph holds a unity pass-through where such a device sits.
- **Released strips report back through the sink**: an unload's own chain release changes native strip state with no batch of its own, so `unloadPlugin` forwards the strips it released to whatever `registerReleasedStripReportSink` wired up, and the composition root — never this module — decides who that is.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/PluginHost`
- **Module boundaries**: `pnpm deps:validate`
