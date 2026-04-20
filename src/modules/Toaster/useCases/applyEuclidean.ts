/**
 * Apply a Euclidean rhythm to a pad's track in the active pattern.
 */

import { toasterStore } from '../stores/toasterStore';

import { euclidean } from './euclidean';

export function applyEuclideanToTrack(padIndex: number, hits: number, steps: number, rotation: number = 0): void {
    const state = toasterStore.value;
    if (!state) {
        return;
    }

    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }

    const rhythm = euclidean(hits, steps, rotation);
    const track = pattern.tracks.find((t) => t.padIndex === padIndex);
    if (!track) {
        return;
    }

    const newSteps = track.steps.map((step, i) => ({
        ...step,
        active: i < rhythm.length ? rhythm[i]! : false,
    }));

    const newTracks = pattern.tracks.map((t) => (t.padIndex === padIndex ? { ...t, steps: newSteps } : t));
    const newPatterns = state.kit.patterns.map((p) => (p.id === pattern.id ? { ...p, tracks: newTracks } : p));
    toasterStore.set({ ...state, kit: { ...state.kit, patterns: newPatterns } });
}
