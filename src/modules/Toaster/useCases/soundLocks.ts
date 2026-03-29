/**
 * Sound locks — per-step engine type overrides (Elektron Digitakt style).
 * A single track can play a different sound on each step.
 *
 * Uses the typed `soundLock` field on Step rather than stuffing
 * an engine type string into the generic paramLocks bag.
 */

import { toasterStore } from '../stores/toasterStore';
import { type DrumEngineType } from '../models/ToasterKit';

export function setSoundLock(padIndex: number, stepIndex: number, engineType: DrumEngineType | null): void {
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
    const step = { ...newSteps[stepIndex]! };

    if (engineType) {
        step.soundLock = engineType;
    } else {
        delete step.soundLock;
    }

    newSteps[stepIndex] = step;

    const newTracks = pattern.tracks.map((t) =>
        t.padIndex === padIndex ? { ...t, steps: newSteps } : t
    );
    const newPatterns = state.kit.patterns.map((p) =>
        p.id === pattern.id ? { ...p, tracks: newTracks } : p
    );
    toasterStore.set({ ...state, kit: { ...state.kit, patterns: newPatterns } });
}

export function getSoundLock(padIndex: number, stepIndex: number): DrumEngineType | null {
    const state = toasterStore.value;
    if (!state) {
        return null;
    }

    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return null;
    }

    const track = pattern.tracks.find((t) => t.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return null;
    }

    return track.steps[stepIndex]!.soundLock ?? null;
}
