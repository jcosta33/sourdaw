/**
 * Reactive state for the Grinder amp simulator.
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

export const grinderStore = new Store<GrinderState>(logger, {
    initialData: {
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
    },
});

export function setGrinderParam<K extends keyof GrinderPatch>(key: K, value: GrinderPatch[K]): void {
    const state = grinderStore.value;
    if (!state) {
        return;
    }
    grinderStore.set({
        ...state,
        patch: { ...state.patch, [key]: value },
    });
}

export function loadGrinderPatch(patch: GrinderPatch): void {
    const state = grinderStore.value;
    if (state) {
        grinderStore.set({ ...state, patch: migrateGrinderPatch(patch) });
    }
}

export function replaceGrinderPatchLocally(patch: GrinderPatch): void {
    const state = grinderStore.value;
    if (!state) {
        return;
    }

    grinderStore.set({
        ...state,
        patch: migrateGrinderPatch(patch),
    });
}

export function updateGrinderMeters(
    inputDb: number,
    preampDb: number,
    powerAmpDb: number,
    outputDb: number,
    gateOpen?: number,
    gateEnvelopeDb?: number,
    sagVoltage?: number,
    latency?: number,
    neuralCpuPercent?: number,
    neuralWarmupProgress?: number
): void {
    const state = grinderStore.value;
    if (state) {
        grinderStore.set({
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
        });
    }
}
