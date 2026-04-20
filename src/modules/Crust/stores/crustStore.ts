/**
 * Crust store — reactive state for the limiter plugin.
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

export type CrustState = {
    patch: CrustPatch;
} & CrustMeterState;

const INITIAL_METERS: CrustMeterState = {
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

export const defaultCrustState: CrustState = {
    patch: DEFAULT_CRUST_PATCH,
    ...INITIAL_METERS,
};

export const crustStore = createStore<CrustState>({
    initialData: defaultCrustState,
});

export function setCrustParam<K extends keyof CrustPatch>(key: K, value: CrustPatch[K]): void {
    const state = crustStore.value;
    if (!state) {
        return;
    }
    crustStore.set({ ...state, patch: { ...state.patch, [key]: value } });
}

export function setCrustUiLevel(level: 1 | 2 | 3 | 4 | 5): void {
    const state = crustStore.value;
    if (state) {
        crustStore.set({ ...state, patch: { ...state.patch, uiLevel: level } });
    }
}

export function loadCrustPatch(patch: CrustPatch): void {
    const state = crustStore.value;
    if (state) {
        crustStore.set({ ...state, patch });
    }
}

export function updateCrustMeters(meters: Partial<CrustMeterState>): void {
    const state = crustStore.value;
    if (state) {
        crustStore.set({ ...state, ...meters });
    }
}

export function resetCrustMeters(): void {
    const state = crustStore.value;
    if (state) {
        crustStore.set({ ...state, ...INITIAL_METERS });
    }
}
