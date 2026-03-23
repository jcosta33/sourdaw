import { type TransientMarker, elasticAudioStore } from './types';

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
