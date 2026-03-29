/**
 * Sound locks — per-step engine type overrides (Elektron Digitakt style).
 * A single track can play a different sound on each step.
 */

import { toasterStore } from '../stores/toasterStore';
import { type DrumEngineType } from '../models/ToasterKit';

/**
 * Set a sound lock on a specific step — that step will use a different engine type.
 * Pass null to clear the lock.
 */
export function setSoundLock(padIndex: number, stepIndex: number, engineType: DrumEngineType | null): void {
    const state = toasterStore.value;
    if (!state) { return; }

    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) { return; }

    const track = pattern.tracks.find((t) => t.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) { return; }

    const newSteps = [...track.steps];
    const step = { ...newSteps[stepIndex]! };

    if (engineType) {
        step.paramLocks = { ...step.paramLocks, _soundLock: engineType as unknown as number };
    } else {
        const { _soundLock: _, ...rest } = step.paramLocks;
        step.paramLocks = rest;
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

/**
 * Get the sound lock for a specific step, or null if none.
 */
export function getSoundLock(padIndex: number, stepIndex: number): DrumEngineType | null {
    const state = toasterStore.value;
    if (!state) { return null; }

    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) { return null; }

    const track = pattern.tracks.find((t) => t.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) { return null; }

    const lock = track.steps[stepIndex]!.paramLocks._soundLock;
    return lock ? (lock as unknown as DrumEngineType) : null;
}
