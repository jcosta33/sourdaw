/**
 * Audio Quantize (Elastic Audio)
 *
 * Slice-and-conform or transient warping engine.
 * Detects transients in audio clips, then time-aligns them to the grid.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type TransientMarker = {
    id: string;
    /** Position in seconds (relative to clip start) */
    positionSec: number;
    /** Strength of the transient (0-1) */
    strength: number;
    /** Is this marker locked (won't move during quantize)? */
    locked: boolean;
};

export type ElasticAudioMode = 'polyphonic' | 'monophonic' | 'rhythmic' | 'x-form';

export type ElasticAudioState = {
    /** Detected transients per clip ID */
    transients: Map<string, TransientMarker[]>;
    /** Default quantize strength (0-1) */
    quantizeStrength: number;
    /** Grid subdivision for quantize */
    gridDivision: number;
    /** Processing mode */
    mode: ElasticAudioMode;
    /** Whether to preserve formants */
    preserveFormants: boolean;
};

export const elasticAudioStore = new Store<ElasticAudioState>(logger, {
    initialData: {
        transients: new Map(),
        quantizeStrength: 1,
        gridDivision: 4,
        mode: 'polyphonic',
        preserveFormants: true,
    },
});

let markerId = 1;

/**
 * Detect transients in an audio buffer using onset energy.
 */
export function detectTransients(
    clipId: string,
    samples: Float32Array,
    sampleRate: number,
    sensitivity: number = 0.5
): TransientMarker[] {
    const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows
    const hopSize = Math.floor(windowSize / 2);
    const threshold = (1 - sensitivity) * 0.1;

    const markers: TransientMarker[] = [];
    let prevEnergy = 0;

    for (let i = 0; i < samples.length - windowSize; i += hopSize) {
        let energy = 0;
        for (let j = i; j < i + windowSize; j++) {
            energy += samples[j]! * samples[j]!;
        }
        energy /= windowSize;

        const flux = energy - prevEnergy;
        if (flux > threshold && energy > 0.001) {
            const positionSec = i / sampleRate;
            // Avoid markers too close together (min 30ms apart)
            const lastMarker = markers[markers.length - 1];
            if (!lastMarker || positionSec - lastMarker.positionSec > 0.03) {
                markers.push({
                    id: `tm-${markerId++}`,
                    positionSec,
                    strength: Math.min(1, flux / 0.05),
                    locked: false,
                });
            }
        }
        prevEnergy = energy;
    }

    const state = elasticAudioStore.value;
    if (state) {
        const newTransients = new Map(state.transients);
        newTransients.set(clipId, markers);
        elasticAudioStore.set({ ...state, transients: newTransients });
    }

    return markers;
}

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

export function setQuantizeStrength(strength: number): void {
    const state = elasticAudioStore.value;
    if (!state) {
        return;
    }
    elasticAudioStore.set({ ...state, quantizeStrength: Math.max(0, Math.min(1, strength)) });
}

export function setElasticMode(mode: ElasticAudioMode): void {
    const state = elasticAudioStore.value;
    if (!state) {
        return;
    }
    elasticAudioStore.set({ ...state, mode });
}

export function lockTransient(clipId: string, transientId: string): void {
    const state = elasticAudioStore.value;
    if (!state) {
        return;
    }
    const markers = state.transients.get(clipId);
    if (!markers) {
        return;
    }
    const newTransients = new Map(state.transients);
    newTransients.set(
        clipId,
        markers.map((m) => (m.id === transientId ? { ...m, locked: !m.locked } : m))
    );
    elasticAudioStore.set({ ...state, transients: newTransients });
}

export function clearTransients(clipId: string): void {
    const state = elasticAudioStore.value;
    if (!state) {
        return;
    }
    const newTransients = new Map(state.transients);
    newTransients.delete(clipId);
    elasticAudioStore.set({ ...state, transients: newTransients });
}
