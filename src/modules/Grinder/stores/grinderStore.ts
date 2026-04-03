/**
 * Reactive state for the Grinder amp simulator.
 * Keyed by deviceId to support multiple simultaneous instances.
 */
import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type GrinderPatch, DEFAULT_PATCH, migrateGrinderPatch } from '../models/GrinderPatch';

const logger = Container.getInstance().get(Logger);

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

export const grinderStore = new Store<GrinderInstances>(logger, { initialData: {} });

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
    if (!state) return;
    grinderStore.set({ ...instances, [deviceId]: { ...state, patch: migrateGrinderPatch(patch) } });
}

export function updateGrinderMeters(
    deviceId: string,
    inputDb: number,
    preampDb: number,
    powerAmpDb: number,
    outputDb: number,
    gateOpen?: number,
    gateEnvelopeDb?: number,
    sagVoltage?: number,
    latency?: number,
    neuralCpuPercent?: number,
    neuralWarmupProgress?: number,
): void {
    const instances = grinderStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_GRINDER_STATE, patch: { ...DEFAULT_PATCH } };
    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            inputDb,
            preampDb,
            powerAmpDb,
            outputDb,
            gateOpen: gateOpen ?? state.gateOpen,
            gateEnvelopeDb: gateEnvelopeDb ?? state.gateEnvelopeDb,
            sagVoltage: sagVoltage ?? state.sagVoltage,
            latency: latency ?? state.latency,
            neuralCpuPercent: neuralCpuPercent ?? state.neuralCpuPercent,
            neuralWarmupProgress: neuralWarmupProgress ?? state.neuralWarmupProgress,
        },
    });
}
