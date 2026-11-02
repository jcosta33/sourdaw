import type { OfflineDeviceNode } from './OfflineDeviceNode';

/**
 * Collaborators the live graph (`engine/`) is handed instead of importing them:
 * `engine/` sits below the module's use cases and repositories
 * (`engine-no-own-application-layers`), so whoever builds an engine object
 * passes these in.
 */

/** One device-parameter write's runtime-ownership receipt. */
export type DeviceParameterWriteReceipt = Readonly<{
    /** Admit a write a still-loading device queues; false when a newer queue owns the parameter. */
    pending: () => boolean;
    /** Stamp a write as it reaches the DSP; the returned call publishes it once applied. */
    begin: () => () => void;
}>;

/** Builds and drives the Web Audio built-in device nodes. */
export type BuiltinDeviceNodeFactory = Readonly<{
    createBuiltinDeviceNode: (
        input: Readonly<{ context: BaseAudioContext; deviceType: string }>
    ) => OfflineDeviceNode | null;
    applyParams: (deviceNode: OfflineDeviceNode, deviceType: string, params: Record<string, number>) => void;
}>;

/** What a WASM device descriptor needs from outside the engine while it loads and runs. */
export type WasmDeviceRuntimeCollaborators = Readonly<{
    createFaustDeviceNode: (context: BaseAudioContext, pluginId: string) => Promise<OfflineDeviceNode | null>;
    reportLatency: (deviceId: string, latencyMs: number) => void;
    clearReportedLatency: (deviceId: string) => void;
}>;

/** Use-case-owned state the live graph writes: parameter-write ownership, reported latency, Faust builds. */
export type EngineUseCaseCollaborators = WasmDeviceRuntimeCollaborators &
    Readonly<{
        captureParameterWriteReceipt: (
            trackId: string,
            deviceId: string,
            paramId: string
        ) => DeviceParameterWriteReceipt;
    }>;

/** Everything a `TrackNode` creates or reports devices through. */
export type EngineDeviceCollaborators = BuiltinDeviceNodeFactory & EngineUseCaseCollaborators;
