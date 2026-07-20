import { kneadStore } from '../stores/kneadStore';

/**
 * Drop the stored pitch contour for a clip. Called when the contour no longer
 * describes the clip's audio — after a successful pitch commit, and whenever the
 * clip's audio is replaced (file drop, normalize, reverse) — so the PitchEditor
 * gate re-opens: the overlay canvas stops swallowing waveform interactions and
 * the Analyze Pitch button is offered again. No-op when the clip has no contour.
 */
export function clearClipPitchContour(clipId: string): void {
    const state = kneadStore.value;
    if (!state || !(clipId in state.contours)) {
        return;
    }

    const contours = { ...state.contours };
    delete contours[clipId];

    kneadStore.set({ ...state, contours });
}
