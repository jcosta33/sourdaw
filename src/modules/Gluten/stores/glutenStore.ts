/**
 * Reactive state for the Gluten compressor.
 * Keyed by deviceId to support multiple simultaneous instances.
 */
import { createStore } from '#/infra/store/createStore';

import { type GlutenPatch, DEFAULT_PATCH } from '../models/GlutenPatch';

export type GlutenState = {
    patch: GlutenPatch;
    grDb: number;
    inputDb: number;
    outputDb: number;
    crest: number;
    phaseCorr: number;
    latency: number;
    uiLevel: 1 | 2 | 3 | 4 | 5;
};

export const DEFAULT_GLUTEN_STATE: GlutenState = {
    patch: DEFAULT_PATCH,
    grDb: 0,
    inputDb: -100,
    outputDb: -100,
    crest: 0,
    phaseCorr: 1,
    latency: 0,
    uiLevel: 2,
};

type GlutenInstances = Record<string, GlutenState>;

export const glutenStore = createStore<GlutenInstances>({ initialData: {} });

export function getGlutenState(deviceId: string): GlutenState {
    return glutenStore.value?.[deviceId] ?? { ...DEFAULT_GLUTEN_STATE, patch: { ...DEFAULT_PATCH } };
}

export function setGlutenParam<K extends keyof GlutenPatch>(deviceId: string, key: K, value: GlutenPatch[K]): void {
    const instances = glutenStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_GLUTEN_STATE, patch: { ...DEFAULT_PATCH } };
    glutenStore.set({ ...instances, [deviceId]: { ...state, patch: { ...state.patch, [key]: value } } });
}

export function setGlutenUiLevel(deviceId: string, level: 1 | 2 | 3 | 4 | 5): void {
    const instances = glutenStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_GLUTEN_STATE, patch: { ...DEFAULT_PATCH } };
    glutenStore.set({ ...instances, [deviceId]: { ...state, uiLevel: level } });
}

export function loadGlutenPatch(deviceId: string, patch: GlutenPatch): void {
    const instances = glutenStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_GLUTEN_STATE, patch: { ...DEFAULT_PATCH } };
    glutenStore.set({ ...instances, [deviceId]: { ...state, patch } });
}

export type GlutenMeterValues = {
    grDb: number;
    inputDb: number;
    outputDb: number;
    crest?: number;
    phaseCorr?: number;
    latency?: number;
};

export function updateGlutenMeters(deviceId: string, meters: GlutenMeterValues): void {
    const instances = glutenStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_GLUTEN_STATE, patch: { ...DEFAULT_PATCH } };
    glutenStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            grDb: meters.grDb,
            inputDb: meters.inputDb,
            outputDb: meters.outputDb,
            crest: meters.crest ?? state.crest,
            phaseCorr: meters.phaseCorr ?? state.phaseCorr,
            latency: meters.latency ?? state.latency,
        },
    });
}
