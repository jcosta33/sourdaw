import { elasticAudioStore } from './types';

/**
 * Quantize detected transients to the grid.
 * Returns the time-shift offsets for each transient.
 */
export function quantizeTransients(
    clipId: string,
    bpm: number
): Array<{ markerId: string; originalSec: number; quantizedSec: number; shiftSec: number }> {
    const state = elasticAudioStore.value;
    if (!state) {
        return [];
    }

    const markers = state.transients.get(clipId);
    if (!markers) {
        return [];
    }

    const beatDuration = 60 / bpm;
    const gridInterval = beatDuration / state.gridDivision;
    const strength = state.quantizeStrength;

    return markers
        .filter((m) => !m.locked)
        .map((m) => {
            const nearestGrid = Math.round(m.positionSec / gridInterval) * gridInterval;
            const shift = (nearestGrid - m.positionSec) * strength;
            return {
                markerId: m.id,
                originalSec: m.positionSec,
                quantizedSec: m.positionSec + shift,
                shiftSec: shift,
            };
        });
}
