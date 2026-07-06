import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCachedAudioBufferWaveformPeaks } from '../getCachedAudioBufferWaveformPeaks';

const mocks = vi.hoisted(() => ({
    audioBufferCacheGetWaveformPeaks: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        getWaveformPeaks: mocks.audioBufferCacheGetWaveformPeaks,
    },
}));

describe('getCachedAudioBufferWaveformPeaks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return cached waveform peaks for the requested sample window', () => {
        const peaks = new Float32Array([0.1, 0.5, 0.25]);
        mocks.audioBufferCacheGetWaveformPeaks.mockReturnValue(peaks);

        const result = getCachedAudioBufferWaveformPeaks({
            bufferId: 'clip-1',
            numBins: 3,
            startSample: 24_000,
            endSample: 72_000,
        });

        expect(result).toBe(peaks);
        expect(mocks.audioBufferCacheGetWaveformPeaks).toHaveBeenCalledWith('clip-1', 3, {
            startSample: 24_000,
            endSample: 72_000,
        });
    });

    it('should delegate without a sample window when no window is requested', () => {
        const peaks = new Float32Array([0.2, 0.4]);
        mocks.audioBufferCacheGetWaveformPeaks.mockReturnValue(peaks);

        const result = getCachedAudioBufferWaveformPeaks({
            bufferId: 'clip-1',
            numBins: 2,
        });

        expect(result).toBe(peaks);
        expect(mocks.audioBufferCacheGetWaveformPeaks).toHaveBeenCalledWith('clip-1', 2);
    });
});
