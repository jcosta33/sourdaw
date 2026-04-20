import { createStore } from '#/infra/store/createStore';

export type GrinderTelemetry = {
    inputDb: number;
    preampDb: number;
    powerAmpDb: number;
    outputDb: number;
    gateOpen: number;
    gateEnvelopeDb: number;
    sagVoltage: number;
    latency: number;
    neuralCpuPercent: number;
    neuralWarmupProgress: number;
};

export const DEFAULT_GRINDER_TELEMETRY: GrinderTelemetry = {
    inputDb: -100,
    preampDb: -100,
    powerAmpDb: -100,
    outputDb: -100,
    gateOpen: 1,
    gateEnvelopeDb: -100,
    sagVoltage: 1,
    latency: 0,
    neuralCpuPercent: 0,
    neuralWarmupProgress: 0,
};

type GrinderTelemetryInstances = Record<string, GrinderTelemetry>;

/**
 * High-frequency volatile telemetry state for Grinder.
 * Decoupled from the persistent patch store to prevent full-UI re-renders at 60fps.
 */
export const grinderTelemetryStore = createStore<GrinderTelemetryInstances>({ initialData: {} });

export function getGrinderTelemetry(deviceId: string): GrinderTelemetry {
    return grinderTelemetryStore.value?.[deviceId] ?? { ...DEFAULT_GRINDER_TELEMETRY };
}

export function updateGrinderTelemetry(deviceId: string, meters: Partial<GrinderTelemetry>): void {
    const instances = grinderTelemetryStore.value ?? {};
    const current = instances[deviceId] ?? { ...DEFAULT_GRINDER_TELEMETRY };

    grinderTelemetryStore.set({
        ...instances,
        [deviceId]: {
            ...current,
            ...meters,
        },
    });
}
