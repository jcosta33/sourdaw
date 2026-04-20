import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    setLoading: vi.fn(),
    setActiveSample: vi.fn(),
    setWaveformPeaks: vi.fn(),
    loadSample: vi.fn(),
    getWaveformPeaks: vi.fn(),
}));

vi.mock('../../stores/crumbsStore', () => ({
    crumbsStore: { value: {} },
    setLoading: mocks.setLoading,
    setActiveSample: mocks.setActiveSample,
    setWaveformPeaks: mocks.setWaveformPeaks,
}));

vi.mock('../../repositories/crumbsBridge', () => ({
    loadSample: mocks.loadSample,
    getWaveformPeaks: mocks.getWaveformPeaks,
}));

import { loadSampleFromPath } from '../loadSample';

describe('loadSampleFromPath', () => {
    beforeEach(() => vi.clearAllMocks());

    it('orchestrates loading process', async () => {
        mocks.loadSample.mockResolvedValue({
            sampleId: 's1',
            sampleRate: 44100,
            channels: 2,
            frameCount: 1000,
            durationSecs: 1.0,
            detectedRoot: 60,
            detectedBpm: 120,
            category: 'drum',
        });
        mocks.getWaveformPeaks.mockResolvedValue([0.1, 0.5, 0.2]);

        await loadSampleFromPath('inst1', '/path/to/kick.wav');

        expect(mocks.setLoading).toHaveBeenCalledWith('inst1', true);
        expect(mocks.loadSample).toHaveBeenCalledWith('inst1', '/path/to/kick.wav');
        expect(mocks.setActiveSample).toHaveBeenCalledWith('inst1', expect.objectContaining({
            sampleId: 's1',
            fileName: 'kick.wav',
        }));
        expect(mocks.setWaveformPeaks).toHaveBeenCalledWith('inst1', [0.1, 0.5, 0.2]);
        expect(mocks.setLoading).toHaveBeenLastCalledWith('inst1', false);
    });

    it('handles errors gracefully', async () => {
        mocks.loadSample.mockRejectedValue(new Error('Load failed'));

        await expect(loadSampleFromPath('inst1', 'bad.wav')).rejects.toThrow('Load failed');
        expect(mocks.setLoading).toHaveBeenLastCalledWith('inst1', false);
    });
});
