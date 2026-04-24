/**
 * Grinder drum machine state store.
 * Holds the current kit, selected pad, sequencer state, and UI level.
 * Reactive — UI subscribes via useStore from #/infra/store/useStore.
 */

import { createStore } from '#/infra/store/createStore';

import { type ToasterKit, type PadState, createDefaultKit } from '../models/ToasterKit';

export type MorphState = {
    enabled: boolean;
    targetPatternId: string | null;
    position: number;
};

export type ToasterState = {
    kit: ToasterKit;
    selectedPadIndex: number;
    isPlaying: boolean;
    currentStep: number;
    uiLevel: 1 | 2 | 3 | 4 | 5;
    engineReady: boolean;
    activeVoices: number;
    morph: MorphState;
};

export const defaultToasterState: ToasterState = {
    kit: createDefaultKit(),
    selectedPadIndex: 0,
    isPlaying: false,
    currentStep: 0,
    uiLevel: 1,
    engineReady: false,
    activeVoices: 0,
    morph: { enabled: false, targetPatternId: null, position: 0 },
};

type ToasterInstances = Record<string, ToasterState>;

export const toasterStore = createStore<ToasterInstances>({
    initialData: {},
});

export function getToasterState(deviceId: string): ToasterState {
    return (toasterStore.value ?? {})[deviceId] ?? defaultToasterState;
}

export function unregisterToasterDevice(deviceId: string): void {
    const state = toasterStore.value;
    if (state && state[deviceId]) {
        const next = { ...state };
        delete next[deviceId];
        toasterStore.set(next);
    }
}

export function selectPad(deviceId: string, index: number): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId] ?? defaultToasterState;
    if (index >= 0 && index < state.kit.pads.length) {
        toasterStore.set({ ...instances, [deviceId]: { ...state, selectedPadIndex: index } });
    }
}

export function updatePad(deviceId: string, index: number, updates: Partial<PadState>): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId] ?? defaultToasterState;
    const pads = [...state.kit.pads];
    if (!pads[index]) {
        return;
    }
    pads[index] = { ...pads[index], ...updates };
    toasterStore.set({ ...instances, [deviceId]: { ...state, kit: { ...state.kit, pads } } });
}

export function loadKit(deviceId: string, kit: ToasterKit): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId] ?? defaultToasterState;
    toasterStore.set({ ...instances, [deviceId]: { ...state, kit, selectedPadIndex: 0 } });
}

export function updateKit(deviceId: string, updates: Partial<ToasterKit>): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId] ?? defaultToasterState;

    toasterStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            kit: {
                ...state.kit,
                ...updates,
            },
        }
    });
}

export function toggleStep(deviceId: string, padIndex: number, stepIndex: number): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId] ?? defaultToasterState;
    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }
    const track = pattern.tracks.find((time) => time.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return;
    }

    const newSteps = [...track.steps];
    newSteps[stepIndex] = { ...newSteps[stepIndex]!, active: !newSteps[stepIndex]!.active };

    const newTracks = pattern.tracks.map((t) => (t.padIndex === padIndex ? { ...t, steps: newSteps } : t));
    const newPatterns = state.kit.patterns.map((p) => (p.id === pattern.id ? { ...p, tracks: newTracks } : p));
    toasterStore.set({ ...instances, [deviceId]: { ...state, kit: { ...state.kit, patterns: newPatterns } } });
}

export function setStepVelocity(deviceId: string, padIndex: number, stepIndex: number, velocity: number): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId] ?? defaultToasterState;
    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }
    const track = pattern.tracks.find((time) => time.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return;
    }

    const newSteps = [...track.steps];
    newSteps[stepIndex] = { ...newSteps[stepIndex]!, velocity: Math.max(0, Math.min(1, velocity)) };

    const newTracks = pattern.tracks.map((t) => (t.padIndex === padIndex ? { ...t, steps: newSteps } : t));
    const newPatterns = state.kit.patterns.map((p) => (p.id === pattern.id ? { ...p, tracks: newTracks } : p));
    toasterStore.set({ ...instances, [deviceId]: { ...state, kit: { ...state.kit, patterns: newPatterns } } });
}
