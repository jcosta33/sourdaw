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

    const pattern = state.kit.patterns.find((param) => param.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }

    const rhythm = euclidean(hits, steps, rotation);
    const track = pattern.tracks.find((time) => time.padIndex === padIndex);
    if (!track) {
        return;
    }

    const newSteps = track.steps.map((step, index) => ({
        ...step,
        active: index < rhythm.length ? rhythm[index]! : false,
    }));

    const newTracks = pattern.tracks.map((time) => (time.padIndex === padIndex ? { ...time, steps: newSteps } : time));
    const newPatterns = state.kit.patterns.map((param) => (param.id === pattern.id ? { ...param, tracks: newTracks } : param));
    toasterStore.set({ ...state, kit: { ...state.kit, patterns: newPatterns } });
}
