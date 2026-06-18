/**
 * Levain instrument state store.
 * Holds the current patch, selected instrument, articulation state, and UI level.
 * Reactive — UI subscribes via useStore from #/infra/store/useStore.
 * Keyed by deviceId.
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

type LevainInstances = Record<string, LevainState>;

export const levainStore = createStore<LevainInstances>({
    initialData: {},
});

export function getLevainState(deviceId: string): LevainState {
    return (levainStore.value ?? {})[deviceId] ?? defaultLevainState;
}

// ---------------------------------------------------------------------------
// State update functions — pure store mutations, no engine calls.
// Engine sync is handled exclusively in useCases/levainParamBridge.ts.
// ---------------------------------------------------------------------------

export function setLevainParam<TKey extends keyof LevainPatch>(
    deviceId: string,
    key: TKey,
    value: LevainPatch[TKey]
): void {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId] ?? defaultLevainState;
    levainStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: { ...state.patch, [key]: value },
        },
    });
}

export function setSampleLoadProgress(deviceId: string, progress: number | null): void {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId] ?? defaultLevainState;
    levainStore.set({ ...instances, [deviceId]: { ...state, sampleLoadProgress: progress } });
}

export function setCurrentArticulation(deviceId: string, articulation: ArticulationType): void {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId] ?? defaultLevainState;
    const entry = state.patch.articulations.find((a) => a.type === articulation);
    levainStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: { ...state.patch, currentArticulation: articulation },
            currentArticulationDisplay: entry ? entry.name : articulation,
        },
    });
}

export function setMacro(deviceId: string, index: number, value: number): void {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId] ?? defaultLevainState;
    if (index >= 0 && index < 8) {
        const macros = [...state.patch.macros] as LevainPatch['macros'];
        macros[index] = value;
        levainStore.set({
            ...instances,
            [deviceId]: {
                ...state,
                patch: { ...state.patch, macros },
            },
        });
    }
}

/**
 * Update a mic position in the store.
 * Engine sync is the caller's responsibility — use levainParamBridge for that.
 */
export function updateMicPosition(deviceId: string, index: number, updates: Partial<MicPositionState>): void {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId] ?? defaultLevainState;
    if (index >= 0 && index < state.patch.micPositions.length) {
        const micPositions = state.patch.micPositions.map((mic, i) => {
            if (i === index) {
                return { ...mic, ...updates };
            }
            return mic;
        });
        levainStore.set({
            ...instances,
            [deviceId]: {
                ...state,
                patch: { ...state.patch, micPositions },
            },
        });
    }
}

export function setEngineReady(deviceId: string, ready: boolean): void {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId] ?? defaultLevainState;
    levainStore.set({ ...instances, [deviceId]: { ...state, engineReady: ready } });
}
