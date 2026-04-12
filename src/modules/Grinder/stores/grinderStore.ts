/**
 * Reactive state for the Grinder amp simulator.
 * Keyed by deviceId to support multiple simultaneous instances.
 */
import { createStore } from '#/infra/store/createStore';
import { type GrinderPatch, DEFAULT_PATCH, migrateGrinderPatch } from '../models/GrinderPatch';

export type GrinderState = {
    patch: GrinderPatch;
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

export const DEFAULT_GRINDER_STATE: GrinderState = {
    patch: DEFAULT_PATCH,
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

type GrinderInstances = Record<string, GrinderState>;

export const grinderStore = createStore<GrinderInstances>({ initialData: {} });

export function getGrinderState(deviceId: string): GrinderState {
    return grinderStore.value?.[deviceId] ?? { ...DEFAULT_GRINDER_STATE, patch: { ...DEFAULT_PATCH } };
}

export function setGrinderParam<K extends keyof GrinderPatch>(deviceId: string, key: K, value: GrinderPatch[K]): void {
    const instances = grinderStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_GRINDER_STATE, patch: { ...DEFAULT_PATCH } };
    grinderStore.set({ ...instances, [deviceId]: { ...state, patch: { ...state.patch, [key]: value } } });
}

export function loadGrinderPatch(deviceId: string, patch: GrinderPatch): void {
    const instances = grinderStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_GRINDER_STATE, patch: { ...DEFAULT_PATCH } };
    grinderStore.set({ ...instances, [deviceId]: { ...state, patch: migrateGrinderPatch(patch) } });
}

export function replaceGrinderPatchLocally(deviceId: string, patch: GrinderPatch): void {
    const instances = grinderStore.value ?? {};
    const state = instances[deviceId];
    if (!state) {return;}
    grinderStore.set({ ...instances, [deviceId]: { ...state, patch: migrateGrinderPatch(patch) } });
}

export type GrinderMeterValues = {
    inputDb: number;
    preampDb: number;
    powerAmpDb: number;
    outputDb: number;
    gateOpen?: number;
    gateEnvelopeDb?: number;
    sagVoltage?: number;
    latency?: number;
    neuralCpuPercent?: number;
    neuralWarmupProgress?: number;
};

export function updateGrinderMeters(deviceId: string, meters: GrinderMeterValues): void {
    const instances = grinderStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_GRINDER_STATE, patch: { ...DEFAULT_PATCH } };
    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            inputDb: meters.inputDb,
            preampDb: meters.preampDb,
            powerAmpDb: meters.powerAmpDb,
            outputDb: meters.outputDb,
            gateOpen: meters.gateOpen ?? state.gateOpen,
            gateEnvelopeDb: meters.gateEnvelopeDb ?? state.gateEnvelopeDb,
            sagVoltage: meters.sagVoltage ?? state.sagVoltage,
            latency: meters.latency ?? state.latency,
            neuralCpuPercent: meters.neuralCpuPercent ?? state.neuralCpuPercent,
            neuralWarmupProgress: meters.neuralWarmupProgress ?? state.neuralWarmupProgress,
        },
    });
}
