import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSampleFromPath } from '../loadSample';

const mocks = vi.hoisted(() => ({
    samplerStoreValue: { value: { instanceId: 'inst1' } },
    setLoading: vi.fn(),
    setActiveSample: vi.fn(),
    setWaveformPeaks: vi.fn(),
    loadSample: vi.fn(),
    getWaveformPeaks: vi.fn(),
}));

vi.mock('../../stores/samplerStore', () => ({
    samplerStore: { get value() { return mocks.samplerStoreValue.value; } },
    setLoading: mocks.setLoading,
    setActiveSample: mocks.setActiveSample,
    setWaveformPeaks: mocks.setWaveformPeaks,
}));

vi.mock('../../repositories/samplerBridge', () => ({
    loadSample: mocks.loadSample,
    getWaveformPeaks: mocks.getWaveformPeaks,
}));

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

        await loadSampleFromPath('/path/to/kick.wav');

        expect(mocks.setLoading).toHaveBeenCalledWith(true);
        expect(mocks.loadSample).toHaveBeenCalledWith('inst1', '/path/to/kick.wav');
        expect(mocks.setActiveSample).toHaveBeenCalledWith(expect.objectContaining({
            sampleId: 's1',
            fileName: 'kick.wav',
        }));
        expect(mocks.setWaveformPeaks).toHaveBeenCalledWith([0.1, 0.5, 0.2]);
        expect(mocks.setLoading).toHaveBeenLastCalledWith(false);
    });

    it('handles errors gracefully', async () => {
        mocks.loadSample.mockRejectedValue(new Error('Load failed'));
        
        await expect(loadSampleFromPath('bad.wav')).rejects.toThrow('Load failed');
        expect(mocks.setLoading).toHaveBeenLastCalledWith(false);
    });
});
