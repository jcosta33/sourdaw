/**
 * Reactive state for the Grinder amp simulator.
 */
import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type GrinderPatch, DEFAULT_PATCH } from '../models/GrinderPatch';

const logger = Container.getInstance().get(Logger);

export type GrinderUiLevel = 1 | 2 | 3 | 4 | 5;

export type GrinderState = {
    patch: GrinderPatch;
    inputDb: number;
    preampDb: number;
    powerAmpDb: number;
    outputDb: number;
    sagVoltage: number;
    latency: number;
    neuralCpuPercent: number;
    uiLevel: GrinderUiLevel;
};

export const grinderStore = new Store<GrinderState>(logger, {
    initialData: {
        patch: DEFAULT_PATCH,
        inputDb: -100,
        preampDb: -100,
        powerAmpDb: -100,
        outputDb: -100,
        sagVoltage: 1,
        latency: 0,
        neuralCpuPercent: 0,
        uiLevel: 1,
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

export function setGrinderUiLevel(level: GrinderUiLevel): void {
    const state = grinderStore.value;
    if (state) {
        grinderStore.set({ ...state, uiLevel: level });
    }
}

export function loadGrinderPatch(patch: GrinderPatch): void {
    const state = grinderStore.value;
    if (state) {
        grinderStore.set({ ...state, patch });
    }
}

export function updateGrinderMeters(
    inputDb: number,
    preampDb: number,
    powerAmpDb: number,
    outputDb: number,
    sagVoltage?: number,
    latency?: number,
    neuralCpuPercent?: number
): void {
    const state = grinderStore.value;
    if (state) {
        grinderStore.set({
            ...state,
            inputDb,
            preampDb,
            powerAmpDb,
            outputDb,
            sagVoltage: sagVoltage ?? state.sagVoltage,
            latency: latency ?? state.latency,
            neuralCpuPercent: neuralCpuPercent ?? state.neuralCpuPercent,
        });
    }
}
