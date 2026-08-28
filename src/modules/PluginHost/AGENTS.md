# PluginHost module — Agent Guidelines

Third-party plugin hosting runtime: manages native plugin discovery (VST3, CLAP, AU), desktop IPC bridge, Web Audio Modules (WAM) host, and Faust dynamic DSP JIT compiler.

## Domain Ownership

Owns third-party native audio plugin lifecycle (VST3, CLAP, AU scanning, loading/unloading, IPC audio bridge, native GUI window management, parameter/preset synchronization), Web Audio Modules (WAM) environment, and Faust dynamic DSP JIT compiler. Does not own WebAudio graph nodes or track channel strips (AudioEngine), or device chain models in the arrangement (Arrangement).

## Public Contract Surface

- **`useCases`**:
    - **Plugin lifecycle & bridge**: `loadPlugin`, `unloadPlugin`, `openPluginGui`, `processAudioIPC`, `setPluginParameter`, `setPluginBypass`, `readPluginState`, `restorePluginState`, `activateExternalPlugin`, `clearLoadedExternalPlugins`, `refreshExternalPluginParameters`.
    - **Scanning & discovery**: `findPluginByName`, `findSupportedPlugin`, `SUPPORTED_PLUGIN_FORMATS`, `isSupportedPluginFormat`, `getExternalPluginContractVersionForCommand`, `getAgentDeviceFactoryManifest`, `startPluginScan`, `addScanPath`, `removeScanPath`.
    - **Faust DSP**: `registerBuiltinFaustDSP`, `registerFaustDSP`, `compileFaustDSP`, `createFaustNode`, `isFaustModule`, `getFaustModuleLatencyMs`, `isFaustInstrumentModule`, `registerProModulationEffects`.
    - **Web Audio Modules**: `initWAMEnvironment`, `registerWAMPlugin`, `getRegisteredPlugins`, `getPluginsByCategory`, `loadWAMPlugin`, `unloadWAMPlugin`, `getActiveInstances`, `registerBuiltinPlugins`.
    - **Handler maps**: `getPluginHostHandlers`.
- **`stores`**: `pluginScanStore` (`defaultPluginScanState`, type `PluginScanState`), `externalPluginActivationStore` (`defaultExternalPluginActivationState`, types `ExternalPluginActivationState`, `ExternalPluginActivationStatus`), `externalPluginParameterStore` (`defaultExternalPluginParameterState`, types `ExternalPluginParameter`, `ExternalPluginParameterSnapshot`, `ExternalPluginParameterState`) — read-only outside the module: its writers stay off the barrel.
- **`events`**: None.
- **`presentations/views`**: None.
- **Handler maps**: `getPluginHostHandlers` (`handleScanPlugins`).

## Key Subsystems

- **`repositories/pluginBridge/`**: Desktop IPC bridge for native plugin host processes (`scanPlugins.ts`, `loadPlugin.ts`, `unloadPlugin.ts`, `openPluginGui.ts`, `closePluginGui.ts`, `processAudioIPC.ts`, `setPluginParameter.ts`, `setPluginBypass.ts`, `getPluginState.ts`, `setPluginState.ts`, `onPluginLatencyChanged.ts`).
- **`services/`**: `pluginLoaderRegistry.ts` (registry coordinating native bridge and WAM instances).
- **`stores/`**: `pluginScanStore.ts` (discovered plugins, scan paths, progress), `externalPluginActivationStore.ts` (activation status and loaded instances).
- **`useCases/faustEngine/`**: Dynamic Faust DSP WebAssembly compiler and builtin effects (`compileFaustDSP.ts`, `builtinDSP.ts`).
- **`useCases/wamPluginHost/`**: Web Audio Modules host runtime and lifecycle manager.

## Invariants & Traps

- **Native scan root security**: Plugin scanner enforces strict platform scan roots (macOS, Windows, Linux default directories). Custom roots require native authorization; symlinks and symlinked ancestor directories are rejected to prevent path traversal.
- **No leaked native handles**: Raw library handles, plugin pointers, and OS window handles stay behind the native desktop boundary; only serializable DTOs and instance IDs cross IPC.
- **Faust synchronization**: Faust is wired in PluginHost and AudioEngine; updates to Faust DSP types or node interfaces must remain synchronized across both modules.
- **Real-time IPC safety**: Native plugin audio processing (`processAudioIPC`) uses shared memory and lock-free ring buffers; audio threads must never block on main-process desktop IPC.
- **WAM sandbox isolation**: Web Audio Modules execute in AudioWorklet scopes under strict descriptor contracts.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/PluginHost`
- **Module boundaries**: `pnpm deps:validate`
