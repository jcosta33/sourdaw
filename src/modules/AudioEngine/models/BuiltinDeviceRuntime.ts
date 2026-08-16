export type DeviceRuntimePorts =
    | {
          inputs: number;
          outputs: number;
          channelsPerPort: number;
          externalInputs: number;
          sidechainRouting: 'available' | 'unavailable' | 'not-applicable';
      }
    | { availability: 'runtime-dependent' };

export type DeviceRuntimeLatency =
    | { kind: 'fixed-samples'; samples: number }
    | { kind: 'pdc-default-zero' }
    | { kind: 'reported-when-ready' }
    | { kind: 'reported-dynamically' }
    | { kind: 'runtime-dependent' };

export type DeviceRuntimeLiveFacts = {
    source: 'AudioEngine.deviceNodeFactory' | 'AudioEngine.wasmDeviceRegistry';
    ports: DeviceRuntimePorts;
    notes: { availability: 'supported' | 'unavailable' | 'runtime-dependent' };
    latency: DeviceRuntimeLatency;
};

export type DeviceRuntimeOfflineFacts = {
    source:
        'AudioEngine.deviceNodeFactory' | 'AudioEngine.faustDeviceStrategy' | 'AudioEngine.nativeDspDeviceFactories';
    availability: 'available' | 'conditional';
    condition?: string;
};

/**
 * Agent-readable runtime capability projection. These values are derived from
 * the exact factory facts below rather than maintained in an adjacent map.
 */
export type DeviceRuntimeCapabilities = {
    liveNode: { availability: 'available' };
    noteAcceptance: DeviceRuntimeLiveFacts['notes'];
    sidechainRouting:
        { availability: 'available' | 'unavailable' | 'not-applicable' } | { availability: 'runtime-dependent' };
    offlineRender: DeviceRuntimeOfflineFacts;
};

export type BuiltinDeviceRuntimeStrategy = {
    live: DeviceRuntimeLiveFacts;
    offline: DeviceRuntimeOfflineFacts;
};

/** Shared by the live node constructor and the offline fallback factory. */
export const SIDECHAIN_COMPRESSOR_WORKLET_OPTIONS: AudioWorkletNodeOptions = {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [2],
};

export const SIDECHAIN_COMPRESSOR_RUNTIME_STRATEGY: BuiltinDeviceRuntimeStrategy = {
    live: {
        source: 'AudioEngine.deviceNodeFactory',
        ports: {
            inputs: 2,
            outputs: 1,
            channelsPerPort: 2,
            externalInputs: 1,
            sidechainRouting: 'available',
        },
        notes: { availability: 'unavailable' },
        latency: { kind: 'fixed-samples', samples: 128 },
    },
    offline: {
        source: 'AudioEngine.deviceNodeFactory',
        availability: 'conditional',
        condition:
            'Uses the two-input worklet only after offline sidechain preparation; otherwise falls back to compressor.',
    },
};

export type AgentBuiltinDeviceRuntime = {
    type: string;
    runtimeVersion: string;
    live: DeviceRuntimeLiveFacts;
    offline: DeviceRuntimeOfflineFacts;
    capabilities: DeviceRuntimeCapabilities;
};

export function projectDeviceRuntimeCapabilities(
    live: DeviceRuntimeLiveFacts,
    offline: DeviceRuntimeOfflineFacts
): DeviceRuntimeCapabilities {
    const sidechainRouting =
        'availability' in live.ports
            ? { availability: 'runtime-dependent' as const }
            : { availability: live.ports.sidechainRouting };
    return {
        liveNode: { availability: 'available' },
        noteAcceptance: live.notes,
        sidechainRouting,
        offlineRender: offline,
    };
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, canonicalize(item)])
        );
    }
    return value;
}

function hash(value: string): string {
    let result = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 0x01000193);
    }
    return (result >>> 0).toString(16).padStart(8, '0');
}

export function getBuiltinDeviceRuntimeVersion(input: Omit<AgentBuiltinDeviceRuntime, 'runtimeVersion'>): string {
    return `runtime-v1:${hash(JSON.stringify(canonicalize(input)))}`;
}
