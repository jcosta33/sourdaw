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
    /**
     * Non-null when the most recent sample load failed. Surfaced in the panel.
     * Optional so existing `LevainState` literals (e.g. loading-spinner defaults)
     * that predate this field still satisfy the type without being updated.
     */
    sampleLoadError?: string | null;
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
    sampleLoadError: null,
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

// Mutators no-op when the device has no registered entry. Seeding a default
// entry here would resurrect a phantom instance after unregisterLevainDevice
// (e.g. a rAF-batched param flush arriving post-teardown). Registration is the
// only place that creates an entry (see registerLevainDevice).

export function setLevainParam<TKey extends keyof LevainPatch>(
    deviceId: string,
    key: TKey,
    value: LevainPatch[TKey]
): void {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId];
    if (!state) {
        return;
    }
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
    const state = instances[deviceId];
    if (!state) {
        return;
    }
    // Starting a fresh load (progress becomes a number) clears any prior error.
    const sampleLoadError = progress === null ? state.sampleLoadError : null;
    levainStore.set({ ...instances, [deviceId]: { ...state, sampleLoadProgress: progress, sampleLoadError } });
}

export function setSampleLoadError(deviceId: string, error: string | null): void {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId];
    if (!state) {
        return;
    }
    // A failed load leaves no in-flight progress; clear the bar so the panel
    // shows the error instead of a stale percentage.
    levainStore.set({ ...instances, [deviceId]: { ...state, sampleLoadError: error, sampleLoadProgress: null } });
}

export function setCurrentArticulation(deviceId: string, articulation: ArticulationType): void {
    const instances = levainStore.value ?? {};
    const state = instances[deviceId];
    if (!state) {
        return;
    }
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
    const state = instances[deviceId];
    if (!state) {
        return;
    }
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
    const state = instances[deviceId];
    if (!state) {
        return;
    }
    if (index >= 0 && index < state.patch.micPositions.length) {
        // Clamp volume to its nominal [0,1] range at the store boundary so the
        // fader's forward (volume→dB) and inverse (dB→volume) scaling agree.
        const clampedUpdates =
            updates.volume === undefined ? updates : { ...updates, volume: Math.max(0, Math.min(1, updates.volume)) };
        const micPositions = state.patch.micPositions.map((mic, i) => {
            if (i === index) {
                return { ...mic, ...clampedUpdates };
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
    const state = instances[deviceId];
    if (!state) {
        return;
    }
    levainStore.set({ ...instances, [deviceId]: { ...state, engineReady: ready } });
}
