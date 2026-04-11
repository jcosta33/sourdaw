import { describe, it, expect, vi } from 'vitest';

vi.mock('#/modules/AudioEngine', () => ({
    audioBufferCache: { get: vi.fn(() => null) },
}));

vi.mock('pitchy', () => ({
    PitchDetector: { forFloat32Array: vi.fn() },
}));

import { trackPitch, detectDominantPitch } from './pitchDetection';

describe('pitchDetection', () => {
    it('trackPitch returns an empty list when the buffer is missing', () => {
        expect(trackPitch('missing')).toEqual([]);
    });

    it('detectDominantPitch returns null when the buffer is missing', () => {
        expect(detectDominantPitch('missing')).toBeNull();
    });
});
