/**
 * Crust store — reactive state for the limiter plugin.
 *
 * Keyed by deviceId to support multiple simultaneous instances (#3672): Crust A
 * and Crust B are legal on separate tracks, and each panel must render its own
 * device's patch and telemetry, never the last writer's.
 *
 * Telemetry (meters) is held in a *separate* store from the patch so a meter
 * tick — which arrives at ~60 Hz per open panel — never rewrites the patch map.
 * `updateCrustMeters` replaces only the ticking device's slice and leaves every
 * other device's slice referentially identical, so a `useCrustMeters` subscriber
 * for an untouched device re-uses its previous snapshot and React skips its
 * re-render. The `useCrustMeters` React binding lives in the presentation layer
 * (`presentations/hooks/useCrustMeters`) so this store stays React-free.
 */
import { createStore } from '#/infra/store/createStore';

import { type CrustPatch, DEFAULT_CRUST_PATCH } from '../models/CrustPatch';

export type CrustMeterState = {
    grDb: number;
    inputDb: number;
    outputDb: number;
    lufsIntegrated: number;
    lufsShortTerm: number;
    lufsMomentary: number;
    lra: number;
    truepeakMax: number;
    truepeakExceeded: boolean;
};

export const INITIAL_METERS: CrustMeterState = {
    grDb: 0,
    inputDb: -100,
    outputDb: -100,
    lufsIntegrated: -100,
    lufsShortTerm: -100,
    lufsMomentary: -100,
    lra: 0,
    truepeakMax: -100,
    truepeakExceeded: false,
};

export type CrustInstanceState = {
    patch: CrustPatch;
};

export const defaultCrustInstanceState: CrustInstanceState = {
    patch: DEFAULT_CRUST_PATCH,
};

type CrustInstances = Record<string, CrustInstanceState>;
type CrustMeterInstances = Record<string, CrustMeterState>;

export const crustStore = createStore<CrustInstances>({ initialData: {} });
export const crustMeterStore = createStore<CrustMeterInstances>({ initialData: {} });

/** Convenience shape for readers that want one device's patch and meters together. */
export type CrustState = CrustInstanceState & CrustMeterState;

export const defaultCrustState: CrustState = {
    patch: DEFAULT_CRUST_PATCH,
    ...INITIAL_METERS,
};

function instanceState(instances: CrustInstances, deviceId: string): CrustInstanceState {
    return instances[deviceId] ?? defaultCrustInstanceState;
}

export function getCrustState(deviceId: string): CrustInstanceState {
    return crustStore.value?.[deviceId] ?? defaultCrustInstanceState;
}

export function getCrustMeters(deviceId: string): CrustMeterState {
    return crustMeterStore.value?.[deviceId] ?? INITIAL_METERS;
}

export function setCrustParam<Key extends keyof CrustPatch>(deviceId: string, key: Key, value: CrustPatch[Key]): void {
    const instances = crustStore.value ?? {};
    const state = instanceState(instances, deviceId);
    crustStore.set({ ...instances, [deviceId]: { ...state, patch: { ...state.patch, [key]: value } } });
}

export function setCrustUiLevel(deviceId: string, level: 1 | 2 | 3 | 4 | 5): void {
    const instances = crustStore.value ?? {};
    const state = instanceState(instances, deviceId);
    crustStore.set({ ...instances, [deviceId]: { ...state, patch: { ...state.patch, uiLevel: level } } });
}

export function loadCrustPatch(deviceId: string, patch: CrustPatch): void {
    const instances = crustStore.value ?? {};
    const state = instanceState(instances, deviceId);
    crustStore.set({ ...instances, [deviceId]: { ...state, patch } });
}

export function updateCrustMeters(deviceId: string, meters: Partial<CrustMeterState>): void {
    const instances = crustMeterStore.value ?? {};
    const prev = instances[deviceId] ?? INITIAL_METERS;
    // Replace only this device's slice; every other device keeps its existing
    // object reference so its `useCrustMeters` snapshot stays `Object.is`-stable.
    crustMeterStore.set({ ...instances, [deviceId]: { ...prev, ...meters } });
}

/**
 * Clear one device's held meter readings back to the "silent" defaults. The
 * panel's Reset button; scoped to the device whose panel pressed it.
 */
export function resetCrustMeters(deviceId: string): void {
    const instances = crustMeterStore.value ?? {};
    crustMeterStore.set({ ...instances, [deviceId]: INITIAL_METERS });
}

/**
 * Drop a device's meter slice when the device is torn down. Without this, a
 * meter slice keyed by a destroyed deviceId would accrete in `crustMeterStore`
 * for the session lifetime. Called from the composition sink with the id the
 * engine registry reports, so removing one Crust leaves every other running
 * instance's meters untouched (#3672).
 */
export function deleteCrustMeters(deviceId: string): void {
    const instances = crustMeterStore.value;
    if (!instances || !Object.hasOwn(instances, deviceId)) {
        return;
    }
    // Rest-omit rather than clone-then-delete: the removed key is expressed in
    // the shape itself, and every surviving slice keeps its reference.
    const { [deviceId]: _removed, ...remaining } = instances;
    crustMeterStore.set(remaining);
}
