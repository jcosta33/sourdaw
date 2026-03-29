/**
 * Grinder drum machine state store.
 * Holds the current kit, selected pad, sequencer state, and UI level.
 * Reactive — UI subscribes via useSyncExternalStore.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type ToasterKit, type PadState, createDefaultKit } from '../models/ToasterKit';

const logger = Container.getInstance().get(Logger);

export type ToasterState = {
    kit: ToasterKit;
    selectedPadIndex: number;
    isPlaying: boolean;
    currentStep: number;
    uiLevel: 1 | 2 | 3 | 4 | 5;
    engineReady: boolean;
    activeVoices: number;
};

export const toasterStore = new Store<ToasterState>(logger, {
    initialData: {
        kit: createDefaultKit(),
        selectedPadIndex: 0,
        isPlaying: false,
        currentStep: 0,
        uiLevel: 1,
        engineReady: false,
        activeVoices: 0,
    },
});

export function selectPad(index: number): void {
    const state = toasterStore.value;
    if (state && index >= 0 && index < state.kit.pads.length) {
        toasterStore.set({ ...state, selectedPadIndex: index });
    }
}

export function setGrinderUiLevel(level: 1 | 2 | 3 | 4 | 5): void {
    const state = toasterStore.value;
    if (state) {
        toasterStore.set({ ...state, uiLevel: level });
    }
}

export function updatePad(index: number, updates: Partial<PadState>): void {
    const state = toasterStore.value;
    if (!state) { return; }
    const pads = [...state.kit.pads];
    if (!pads[index]) { return; }
    pads[index] = { ...pads[index], ...updates };
    toasterStore.set({ ...state, kit: { ...state.kit, pads } });
}

export function updateKitParam(key: keyof ToasterKit, value: number | string): void {
    const state = toasterStore.value;
    if (!state) { return; }
    toasterStore.set({ ...state, kit: { ...state.kit, [key]: value } });
}

export function loadKit(kit: ToasterKit): void {
    const state = toasterStore.value;
    if (state) {
        toasterStore.set({ ...state, kit, selectedPadIndex: 0 });
    }
}

export function toggleStep(padIndex: number, stepIndex: number): void {
    const state = toasterStore.value;
    if (!state) { return; }
    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) { return; }
    const track = pattern.tracks.find((t) => t.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) { return; }

    const newSteps = [...track.steps];
    newSteps[stepIndex] = { ...newSteps[stepIndex]!, active: !newSteps[stepIndex]!.active };

    const newTracks = pattern.tracks.map((t) =>
        t.padIndex === padIndex ? { ...t, steps: newSteps } : t
    );
    const newPatterns = state.kit.patterns.map((p) =>
        p.id === pattern.id ? { ...p, tracks: newTracks } : p
    );
    toasterStore.set({ ...state, kit: { ...state.kit, patterns: newPatterns } });
}

export function setStepVelocity(padIndex: number, stepIndex: number, velocity: number): void {
    const state = toasterStore.value;
    if (!state) { return; }
    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) { return; }
    const track = pattern.tracks.find((t) => t.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) { return; }

    const newSteps = [...track.steps];
    newSteps[stepIndex] = { ...newSteps[stepIndex]!, velocity: Math.max(0, Math.min(1, velocity)) };

    const newTracks = pattern.tracks.map((t) =>
        t.padIndex === padIndex ? { ...t, steps: newSteps } : t
    );
    const newPatterns = state.kit.patterns.map((p) =>
        p.id === pattern.id ? { ...p, tracks: newTracks } : p
    );
    toasterStore.set({ ...state, kit: { ...state.kit, patterns: newPatterns } });
}

export function setGrinderEngineReady(ready: boolean): void {
    const state = toasterStore.value;
    if (state) {
        toasterStore.set({ ...state, engineReady: ready });
    }
}
