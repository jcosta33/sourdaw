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

export const toasterStore = createStore<ToasterState>({
    initialData: defaultToasterState,
});

export function selectPad(index: number): void {
    const state = toasterStore.value;
    if (state && index >= 0 && index < state.kit.pads.length) {
        toasterStore.set({ ...state, selectedPadIndex: index });
    }
}

export function updatePad(index: number, updates: Partial<PadState>): void {
    const state = toasterStore.value;
    if (!state) {
        return;
    }
    const pads = [...state.kit.pads];
    if (!pads[index]) {
        return;
    }
    pads[index] = { ...pads[index], ...updates };
    toasterStore.set({ ...state, kit: { ...state.kit, pads } });
}

export function loadKit(kit: ToasterKit): void {
    const state = toasterStore.value;
    if (state) {
        toasterStore.set({ ...state, kit, selectedPadIndex: 0 });
    }
}

export function updateKit(updates: Partial<ToasterKit>): void {
    const state = toasterStore.value;
    if (!state) {
        return;
    }

    toasterStore.set({
        ...state,
        kit: {
            ...state.kit,
            ...updates,
        },
    });
}

export function toggleStep(padIndex: number, stepIndex: number): void {
    const state = toasterStore.value;
    if (!state) {
        return;
    }
    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }
    const track = pattern.tracks.find((t) => t.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return;
    }

    const newSteps = [...track.steps];
    newSteps[stepIndex] = { ...newSteps[stepIndex]!, active: !newSteps[stepIndex]!.active };

    const newTracks = pattern.tracks.map((t) => (t.padIndex === padIndex ? { ...t, steps: newSteps } : t));
    const newPatterns = state.kit.patterns.map((p) => (p.id === pattern.id ? { ...p, tracks: newTracks } : p));
    toasterStore.set({ ...state, kit: { ...state.kit, patterns: newPatterns } });
}

export function setStepVelocity(padIndex: number, stepIndex: number, velocity: number): void {
    const state = toasterStore.value;
    if (!state) {
        return;
    }
    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }
    const track = pattern.tracks.find((t) => t.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return;
    }

    const newSteps = [...track.steps];
    newSteps[stepIndex] = { ...newSteps[stepIndex]!, velocity: Math.max(0, Math.min(1, velocity)) };

    const newTracks = pattern.tracks.map((t) => (t.padIndex === padIndex ? { ...t, steps: newSteps } : t));
    const newPatterns = state.kit.patterns.map((p) => (p.id === pattern.id ? { ...p, tracks: newTracks } : p));
    toasterStore.set({ ...state, kit: { ...state.kit, patterns: newPatterns } });
}
