/**
 * Levain instrument state store.
 * Holds the current patch, selected instrument, articulation state, and UI level.
 * Reactive — UI subscribes via useStore from #/infra/store/useStore.
 *
 * This store is a pure reactive state container. Engine calls belong in
 * useCases/levainParamBridge.ts. Previously this store had a circular
 * dependency with levainParamBridge — that has been removed.
 */

import { createStore } from '#/infra/store/createStore';

import {
    type LevainPatch,
    type ArticulationType,
    type MicPositionState,
    createDefaultPatch,
} from '../models/LevainPatch';

export type LevainUiLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type LevainState = {
    patch: LevainPatch;
    uiLevel: LevainUiLevel;
    engineReady: boolean;
    sampleLoadProgress: number | null;
    activeVoices: number;
    peakL: number;
    peakR: number;
    currentArticulationDisplay: string;
};

export const defaultLevainState: LevainState = {
    patch: createDefaultPatch('violin-1'),
    uiLevel: 1,
    engineReady: false,
    sampleLoadProgress: null,
    activeVoices: 0,
    peakL: 0,
    peakR: 0,
    currentArticulationDisplay: 'Long',
};

export const levainStore = createStore<LevainState>({
    initialData: defaultLevainState,
});

// ---------------------------------------------------------------------------
// State update functions — pure store mutations, no engine calls.
// Engine sync is handled exclusively in useCases/levainParamBridge.ts.
// ---------------------------------------------------------------------------

export function setLevainParam<Key extends keyof LevainPatch>(key: Key, value: LevainPatch[Key]): void {
    const state = levainStore.value;
    if (state) {
        levainStore.set({
            ...state,
            patch: { ...state.patch, [key]: value },
        });
    }
}

export function setSampleLoadProgress(progress: number | null): void {
    const state = levainStore.value;
    if (state) {
        levainStore.set({ ...state, sampleLoadProgress: progress });
    }
}

export function setCurrentArticulation(articulation: ArticulationType): void {
    const state = levainStore.value;
    if (state) {
        const entry = state.patch.articulations.find((a) => a.type === articulation);
        levainStore.set({
            ...state,
            patch: { ...state.patch, currentArticulation: articulation },
            currentArticulationDisplay: entry ? entry.name : articulation,
        });
    }
}

export function setMacro(index: number, value: number): void {
    const state = levainStore.value;
    if (state && index >= 0 && index < 8) {
        const macros = [...state.patch.macros] as LevainPatch['macros'];
        macros[index] = value;
        levainStore.set({
            ...state,
            patch: { ...state.patch, macros },
        });
    }
}

/**
 * Update a mic position in the store.
 * Engine sync is the caller's responsibility — use levainParamBridge for that.
 */
export function updateMicPosition(index: number, updates: Partial<MicPositionState>): void {
    const state = levainStore.value;
    if (state && index >= 0 && index < state.patch.micPositions.length) {
        const micPositions = state.patch.micPositions.map((mic, i) => {
            if (i === index) {
                return { ...mic, ...updates };
            }
            return mic;
        });
        levainStore.set({
            ...state,
            patch: { ...state.patch, micPositions },
        });
    }
}

export function setEngineReady(ready: boolean): void {
    const state = levainStore.value;
    if (state) {
        levainStore.set({ ...state, engineReady: ready });
    }
}
