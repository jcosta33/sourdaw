# Software Patterns for Factory Content

## Overview
The DAW currently supports multiple parallel ecosystems of built-in audio devices (instruments and effects). While functionally operational, the codebase exhibits significant architectural fragmentation in how these devices are defined, instantiated, and controlled. This audit examines the current patterns, critiques the redundancies, and proposes cleaner, more scalable software patterns (such as Strategy and unified Abstract Factories) to manage all factory content uniformly.

## Current State and Discrepancies

### 1. The "Split Brain" Ecosystem
The factory content is split across three entirely different architectural paradigms:
- **Legacy Web Audio API (`builtin-`)**: Synchronous instantiation. Parameters are applied via direct mutation of `AudioParam` objects (e.g., `applyEqParams`, `applyReverbParams`). Definitions live in `builtinEffectDescriptors.ts` and `builtinInstrumentDescriptors.ts`.
- **Faust DSP (`faust-`)**: Asynchronous instantiation (requires WASM compilation and `AudioWorkletNode` setup). Parameters are applied via `setParamValue` on the AudioWorklet. Definitions live in `faustEffectDescriptors.ts` and `builtinDSP.ts`.
- **Native DSP (Rust/WASM - `native-`)**: Premium effects and instruments (like Fermenter, Toaster, etc.) that also compile to `AudioWorkletNode` but have their own unique instantiation functions (e.g., `createFermenterNode`, `createToasterNode`) and custom parameter setting interfaces.

### 2. Pattern Critique: The `buildDeviceChain.ts` Bottleneck
The current instantiation logic inside `src/modules/AudioEngine/useCases/buildDeviceChain.ts` is highly procedural. It relies on a long sequence of type checks (`isFaustModule`, `isNativeDspDevice`, `isFermenterDevice`, `isToasterDevice`, etc.) to determine which factory function to call.
- **Violation of Open-Closed Principle:** Every time a new device type or DSP backend is added, the core audio engine routing logic (`buildDeviceChain.ts`) must be modified.
- **Redundancy:** There are multiple redundant effects (e.g., `builtin-reverb` vs `faust-zita-rev1-reverb`). As previously audited, the legacy `builtin-` Web Audio effects should eventually be deprecated, but their existence currently forces the engine to maintain two entirely different ways of handling basic effects.
- **Inconsistent Parameter Interfaces:** When a device is returned from the build chain, the consuming code has to interact with different interfaces depending on the underlying technology:
  - Native DSP: `nativeDsp.setParam(name, value)`
  - Faust: implicitly handled by the worklet
  - Legacy: `applyParams(node, deviceType, params)`

## Suggested Architectural Patterns

To handle the factory content in the cleanest possible way, the application should transition to a **unified Abstract Factory** and the **Strategy Pattern**.

### 1. The unified `AudioDeviceStrategy` Interface
Rather than the audio engine knowing the difference between Web Audio, Faust, and Rust/WASM, all devices should conform to a standard `AudioDeviceStrategy` interface.

```typescript
interface AudioDeviceStrategy {
    /** The Web Audio node to connect in the graph */
    audioNode: AudioNode;
    
    /** Uniform method for updating a parameter */
    setParameter(id: string, value: number): void;
    
    /** Optional method for sending MIDI/note data (for instruments) */
    noteOn?(note: number, velocity: number): void;
    noteOff?(note: number): void;
    
    /** Cleanup resources when removed */
    destroy(): void;
}
```

### 2. Concrete Strategies
We would then implement concrete strategies for each backend:
- `WebAudioDeviceStrategy`: Wraps the legacy nodes and maps `setParameter` to `AudioParam.value`.
- `FaustDeviceStrategy`: Wraps the Faust WAM/Worklet and maps `setParameter` to worklet messages.
- `NativeDspDeviceStrategy`: Wraps the Rust WASM nodes and maps `setParameter` to their specific Wasm/Worklet interface.

### 3. The `DeviceFactory` Registry
Instead of a massive `if/else` block, the engine should use a single `DeviceFactoryRegistry` where modules can register their instantiation capabilities asynchronously.

```typescript
type DeviceCreator = (ctx: AudioContext, deviceId: string) => Promise<AudioDeviceStrategy>;

class DeviceFactoryRegistry {
    private creators = new Map<string, DeviceCreator>();

    register(prefix: string, creator: DeviceCreator) {
        this.creators.set(prefix, creator);
    }

    async createDevice(ctx: AudioContext, typeId: string): Promise<AudioDeviceStrategy> {
        // e.g., 'faust-zita-rev1' -> prefix 'faust'
        const prefix = typeId.split('-')[0]; 
        const creator = this.creators.get(prefix);
        if (!creator) throw new Error(\`Unknown device prefix: \${prefix}\`);
        return creator(ctx, typeId);
    }
}
```

### 4. Descriptor Unification
Currently, descriptors (the metadata telling the UI what sliders to draw) are scattered across multiple files and hardcoded. 
- We should adopt a single `PluginDescriptor` registry.
- Since we are moving towards WAM 2.0 (Web Audio Modules) for Faust and potentially Native DSP, the WAM descriptor format should be treated as the source of truth.
- Legacy `builtin-` devices can be adapted to output WAM-compatible descriptors so the UI (like the Inspector) only has to render one generic slider component structure.

## Summary of Recommendations
1. **Unify Interfaces:** Implement a standard `AudioDeviceStrategy` interface that all audio devices (Legacy, Faust, Native WASM) must implement. This abstracts parameter updates and MIDI handling away from the core routing engine.
2. **Registry Pattern:** Replace the procedural `if/else` instantiation in `buildDeviceChain.ts` with a dynamic `DeviceFactoryRegistry`.
3. **Deprecate Legacy Redundancy (Future Goal):** Acknowledge that the `builtin-` (Web Audio) layer is redundant relative to the `faust-` layer. Maintain them for now using the new Strategy pattern, but plan to eventually deprecate them to reduce the testing and maintenance surface area.
4. **WAM 2.0 Alignment:** Align all descriptor formats and parameter-setting APIs with the WAM 2.0 specification as outlined in the `faust-wam-plugins` skill guidelines.