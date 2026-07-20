import { beforeEach, describe, expect, it } from 'vitest';

import { defaultKneadState, kneadStore, type PitchContour } from '../../stores/kneadStore';
import { clearClipPitchContour } from '../clearClipPitchContour';

function contour(lastTimeMs: number): PitchContour {
    return {
        points: [
            { time_ms: 0, frequency_hz: 220, confidence: 0.9, voiced: true },
            { time_ms: lastTimeMs, frequency_hz: 220, confidence: 0.9, voiced: true },
        ],
        sample_rate: 48000,
        hop_size: 256,
    };
}

describe('clearClipPitchContour', () => {
    beforeEach(() => {
        kneadStore.set({
            ...defaultKneadState,
            contours: { 'clip-1': contour(300), 'clip-2': contour(500) },
        });
    });

    it('removes the contour for the given clip and keeps every other contour', () => {
        clearClipPitchContour('clip-1');

        expect(kneadStore.value?.contours['clip-1']).toBeUndefined();
        expect(kneadStore.value?.contours['clip-2']).toEqual(contour(500));
    });

    it('is a no-op when the clip has no contour', () => {
        const before = kneadStore.value;

        clearClipPitchContour('clip-unknown');

        expect(kneadStore.value).toBe(before);
        expect(kneadStore.value?.contours['clip-1']).toEqual(contour(300));
    });

    it('is a no-op when the store is uninitialized', () => {
        kneadStore.set(null);

        expect(() => clearClipPitchContour('clip-1')).not.toThrow();
        expect(kneadStore.value).toBeNull();
    });
});
