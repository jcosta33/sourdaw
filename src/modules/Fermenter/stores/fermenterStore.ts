/**
 * Fermenter synth state store.
 * Holds the current patch and UI state. Reactive — UI subscribes via useSyncExternalStore.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type FermenterPatch, DEFAULT_PATCH } from '../models/FermenterPatch';

const logger = Container.getInstance().get(Logger);

export type FermenterState = {
    patch: FermenterPatch;
    activeVoices: number;
    engineReady: boolean;
    uiLevel: 1 | 2 | 3 | 4 | 5;
    /** Peak output levels for meters (updated from worklet) */
    peakL: number;
    peakR: number;
    /** Scope buffer (last 128 samples for oscilloscope) */
    scopeBuffer: Float32Array | null;
};

export const fermenterStore = new Store<FermenterState>(logger, {
    initialData: {
        patch: DEFAULT_PATCH,
        activeVoices: 0,
        engineReady: false,
        uiLevel: 2,
        peakL: 0,
        peakR: 0,
        scopeBuffer: null,
    },
});

export function setFermenterParam(key: keyof FermenterPatch, value: number): void {
    const state = fermenterStore.value;
    if (!state) { return; }
    fermenterStore.set({
        ...state,
        patch: { ...state.patch, [key]: value },
    });
}

export function setFermenterUiLevel(level: 1 | 2 | 3 | 4 | 5): void {
    const state = fermenterStore.value;
    if (state) {
        fermenterStore.set({ ...state, uiLevel: level });
    }
}

export function loadFermenterPatch(patch: FermenterPatch): void {
    const state = fermenterStore.value;
    if (state) {
        fermenterStore.set({ ...state, patch });
    }
}

export function updateFermenterMetrics(activeVoices: number, peakL: number, peakR: number): void {
    const state = fermenterStore.value;
    if (state) {
        fermenterStore.set({ ...state, activeVoices, peakL, peakR });
    }
}

export function updateFermenterScope(buffer: Float32Array): void {
    const state = fermenterStore.value;
    if (state) {
        fermenterStore.set({ ...state, scopeBuffer: buffer });
    }
}

export function setFermenterEngineReady(ready: boolean): void {
    const state = fermenterStore.value;
    if (state) {
        fermenterStore.set({ ...state, engineReady: ready });
    }
}
