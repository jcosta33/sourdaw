/**
 * Reactive state for the Gluten compressor.
 * Keyed by deviceId to support multiple simultaneous instances.
 *
 * Telemetry (meters) is held in a *separate* store from the patch so a meter
 * tick — which arrives at ~60 Hz per open panel — never rewrites the patch map.
 * `updateGlutenMeters` replaces only the ticking device's slice and leaves every
 * other device's slice referentially identical, so a `useGlutenMeters` subscriber
 * for an untouched device re-uses its previous snapshot and React skips its
 * re-render (no cross-instance meter fan-out). The `useGlutenMeters` React binding
 * lives in the presentation layer (`presentations/hooks/useGlutenMeters`) so this
 * store stays React-free.
 */
import { createStore } from '#/infra/store/createStore';

import { type GlutenPatch, DEFAULT_PATCH } from '../models/GlutenPatch';

export type GlutenState = {
    patch: GlutenPatch;
    uiLevel: 1 | 2 | 3 | 4 | 5;
};

export const DEFAULT_GLUTEN_STATE: GlutenState = {
    patch: DEFAULT_PATCH,
    uiLevel: 2,
};

type GlutenInstances = Record<string, GlutenState>;

export const glutenStore = createStore<GlutenInstances>({ initialData: {} });

/** Per-device meter telemetry, separate from the patch store. */
export type GlutenMeters = {
    grDb: number;
    inputDb: number;
    outputDb: number;
    crest: number;
    phaseCorr: number;
    latency: number;
};

export const DEFAULT_GLUTEN_METERS: GlutenMeters = {
    grDb: 0,
    inputDb: -100,
    outputDb: -100,
    crest: 0,
    phaseCorr: 1,
    latency: 0,
};

type GlutenMeterInstances = Record<string, GlutenMeters>;

export const glutenMeterStore = createStore<GlutenMeterInstances>({ initialData: {} });

export function getGlutenState(deviceId: string): GlutenState {
    return glutenStore.value?.[deviceId] ?? { ...DEFAULT_GLUTEN_STATE, patch: { ...DEFAULT_PATCH } };
}

export function getGlutenMeters(deviceId: string): GlutenMeters {
    return glutenMeterStore.value?.[deviceId] ?? DEFAULT_GLUTEN_METERS;
}

export function setGlutenParam<Key extends keyof GlutenPatch>(
    deviceId: string,
    key: Key,
    value: GlutenPatch[Key]
): void {
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
    const instances = glutenMeterStore.value ?? {};
    const prev = instances[deviceId] ?? DEFAULT_GLUTEN_METERS;
    // Replace only this device's slice; every other device keeps its existing
    // object reference so its `useGlutenMeters` snapshot stays `Object.is`-stable.
    glutenMeterStore.set({
        ...instances,
        [deviceId]: {
            grDb: meters.grDb,
            inputDb: meters.inputDb,
            outputDb: meters.outputDb,
            crest: meters.crest ?? prev.crest,
            phaseCorr: meters.phaseCorr ?? prev.phaseCorr,
            latency: meters.latency ?? prev.latency,
        },
    });
}
