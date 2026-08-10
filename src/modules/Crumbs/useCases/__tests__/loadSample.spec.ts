import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    setLoading: vi.fn(),
    setActiveSample: vi.fn(),
    setWaveformPeaks: vi.fn(),
    loadSample: vi.fn(),
    getWaveformPeaks: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.warn },
}));

vi.mock('../../stores/crumbsStore', () => ({
    crumbsStore: { value: {} },
    setLoading: mocks.setLoading,
    setActiveSample: mocks.setActiveSample,
    setWaveformPeaks: mocks.setWaveformPeaks,
}));

vi.mock('../../repositories/crumbsBridge/loadSample', () => ({
    loadSample: mocks.loadSample,
}));

vi.mock('../../repositories/crumbsBridge/getWaveformPeaks', () => ({
    getWaveformPeaks: mocks.getWaveformPeaks,
}));

import { loadSampleFromPath } from '../loadSample';

import type { CrumbsLoadResult } from '../../models/CrumbsTypes';

function makeLoadResult(overrides: Partial<CrumbsLoadResult> = {}): CrumbsLoadResult {
    return {
        sampleId: 1,
        sampleRate: 44100,
        channels: 2,
        frameCount: 1000,
        durationSecs: 1.0,
        detectedRoot: 60,
        detectedBpm: 120,
        category: 'percussive',
        decodeWarningCount: 0,
        decodeWarnings: [],
        ...overrides,
    };
}

describe('loadSampleFromPath', () => {
    beforeEach(() => vi.clearAllMocks());

    it('orchestrates loading process', async () => {
        mocks.loadSample.mockResolvedValue(makeLoadResult());
        mocks.getWaveformPeaks.mockResolvedValue([0.1, 0.5, 0.2]);

        await loadSampleFromPath('inst1', '/path/to/kick.wav');

        expect(mocks.setLoading).toHaveBeenCalledWith('inst1', true);
        expect(mocks.loadSample).toHaveBeenCalledWith('inst1', '/path/to/kick.wav');
        expect(mocks.setActiveSample).toHaveBeenCalledWith(
            'inst1',
            expect.objectContaining({
                sampleId: 1,
                fileName: 'kick.wav',
                filePath: '/path/to/kick.wav',
                category: 'percussive',
            })
        );
        expect(mocks.setWaveformPeaks).toHaveBeenCalledWith('inst1', [0.1, 0.5, 0.2]);
        expect(mocks.setLoading).toHaveBeenLastCalledWith('inst1', false);
    });

    it('reports partial corruption returned by the native decoder', async () => {
        mocks.loadSample.mockResolvedValue(
            makeLoadResult({
                decodeWarningCount: 2,
                decodeWarnings: ['malformed stream: corrupt frame', 'truncated frame'],
            })
        );
        mocks.getWaveformPeaks.mockResolvedValue([]);

        await loadSampleFromPath('inst1', '/path/to/damaged.wav');

        expect(mocks.warn).toHaveBeenCalledWith('Sample imported after skipping 2 corrupt audio packets:', [
            'malformed stream: corrupt frame',
            'truncated frame',
        ]);
    });

    it('stores sample metadata names from native Windows paths', async () => {
        mocks.loadSample.mockResolvedValue(makeLoadResult());
        mocks.getWaveformPeaks.mockResolvedValue([]);

        await loadSampleFromPath('inst1', 'D:\\Loops\\kick.wav');

        expect(mocks.setActiveSample).toHaveBeenCalledWith(
            'inst1',
            expect.objectContaining({
                fileName: 'kick.wav',
                filePath: 'D:\\Loops\\kick.wav',
            })
        );
    });

    it('passes through recognised categories unchanged', async () => {
        for (const category of ['percussive', 'tonal', 'loop', 'unknown'] as const) {
            vi.clearAllMocks();
            mocks.loadSample.mockResolvedValue(makeLoadResult({ category }));
            mocks.getWaveformPeaks.mockResolvedValue([]);

            await loadSampleFromPath('inst1', '/s.wav');

            expect(mocks.setActiveSample).toHaveBeenCalledWith('inst1', expect.objectContaining({ category }));
        }
    });

    it("coerces an unrecognised backend category to 'unknown'", async () => {
        // A future Rust classifier category not yet in the TS union must not leak
        // through as an arbitrary string.
        mocks.loadSample.mockResolvedValue(makeLoadResult({ category: 'vocal-chop' }));
        mocks.getWaveformPeaks.mockResolvedValue([]);

        await loadSampleFromPath('inst1', '/mystery.wav');

        expect(mocks.setActiveSample).toHaveBeenCalledWith('inst1', expect.objectContaining({ category: 'unknown' }));
    });

    it('requests waveform peaks at the finest level for a short sample', async () => {
        // 1000 frames fits well under any reasonable canvas width, so level 0
        // (the finest) is already O(width)-bounded.
        mocks.loadSample.mockResolvedValue(makeLoadResult({ sampleId: 7, frameCount: 1000 }));
        mocks.getWaveformPeaks.mockResolvedValue([]);

        await loadSampleFromPath('inst1', '/short.wav', 800);

        expect(mocks.getWaveformPeaks).toHaveBeenCalledWith('inst1', 7, 0);
    });

    it('requests a coarser mipmap level for a long recording to bound the payload', async () => {
        // ~60s at 48kHz. Hard-coding level 0 here would ship ~90k pairs over IPC;
        // a width-derived level keeps it O(canvas width).
        mocks.loadSample.mockResolvedValue(makeLoadResult({ sampleId: 9, frameCount: 2_880_000 }));
        mocks.getWaveformPeaks.mockResolvedValue([]);

        await loadSampleFromPath('inst1', '/long.wav', 800);

        // base_block 64 × 2^level >= frameCount / (width*2) = 1800 → first is 2048 at level 5.
        expect(mocks.getWaveformPeaks).toHaveBeenCalledWith('inst1', 9, 5);
    });

    it('clamps the requested level to the coarsest available so the backend never rejects it', async () => {
        // A tiny sample has very few mipmap levels; a huge target width must not
        // ask for a level past the pyramid's coarsest entry.
        mocks.loadSample.mockResolvedValue(makeLoadResult({ sampleId: 3, frameCount: 128 }));
        mocks.getWaveformPeaks.mockResolvedValue([]);

        await loadSampleFromPath('inst1', '/tiny.wav', 4000);

        // 128 frames → ceil(128/64)=2 level-0 pairs → maxLevel = ceil(log2(2)) = 1.
        const requestedLevel = mocks.getWaveformPeaks.mock.calls[0]?.[2] as number;
        expect(requestedLevel).toBeLessThanOrEqual(1);
        expect(requestedLevel).toBeGreaterThanOrEqual(0);
    });

    it('still completes loading when waveform peaks fail', async () => {
        mocks.loadSample.mockResolvedValue(makeLoadResult());
        mocks.getWaveformPeaks.mockRejectedValue(new Error('peaks unavailable'));

        await loadSampleFromPath('inst1', '/x.wav');

        expect(mocks.setActiveSample).toHaveBeenCalledTimes(1);
        expect(mocks.setWaveformPeaks).not.toHaveBeenCalled();
        expect(mocks.warn).toHaveBeenCalledWith('Waveform peak loading failed:', expect.any(Error));
        // Loading flag is still cleared on the success path despite the peak failure.
        expect(mocks.setLoading).toHaveBeenLastCalledWith('inst1', false);
    });

    it('handles errors gracefully', async () => {
        mocks.loadSample.mockRejectedValue(new Error('Load failed'));

        await expect(loadSampleFromPath('inst1', 'bad.wav')).rejects.toThrow('Load failed');
        expect(mocks.setLoading).toHaveBeenLastCalledWith('inst1', false);
    });
});
