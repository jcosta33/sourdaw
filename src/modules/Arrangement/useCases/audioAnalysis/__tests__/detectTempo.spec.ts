import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../detectTempo';

type FakeBuffer = {
    sampleRate: number;
    length: number;
    channel: Float32Array;
    getChannelData: (n: number) => Float32Array;
};

const mocks = vi.hoisted(() => ({
    getBufferForClip: vi.fn<(clipId: string) => { buffer: FakeBuffer; audioBufferId: string } | null>(),
}));

vi.mock('../helpers', () => ({
    getBufferForClip: (clipId: string) => mocks.getBufferForClip(clipId),
}));

function makeBuffer(positions: number[], opts: { sampleRate?: number; length?: number } = {}): FakeBuffer {
    const sampleRate = opts.sampleRate ?? 1000;
    const length = opts.length ?? Math.max(...positions, 1) + sampleRate;
    const channel = new Float32Array(length);
    for (const p of positions) {
        channel[p] = 1.0;
    }
    return { sampleRate, length, channel, getChannelData: (n: number) => (n === 0 ? channel : new Float32Array(0)) };
}

describe('detectTempo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when no audio buffer is cached for the clip', async () => {
        mocks.getBufferForClip.mockReturnValue(null);

        expect(await subject.detectTempo('missing')).toBeNull();
    });

    it('falls back to 120 BPM when fewer than two onsets are detected', async () => {
        // A single transient cannot define an inter-onset interval.
        mocks.getBufferForClip.mockReturnValue({
            buffer: makeBuffer([0]),
            audioBufferId: 'b1',
        });

        expect(await subject.detectTempo('c1')).toBe(120);
    });

    it('derives tempo from the median inter-onset interval of regular peaks', async () => {
        // Peaks every 500 samples at sampleRate 1000 => 0.5s gap => 120 BPM.
        mocks.getBufferForClip.mockReturnValue({
            buffer: makeBuffer([0, 500, 1000, 1500, 2000]),
            audioBufferId: 'b1',
        });

        expect(await subject.detectTempo('c1')).toBe(120);
    });

    it('clamps implausibly slow tempos up to the 40 BPM floor', async () => {
        // Peaks 2.5s apart => 60/2.5 = 24 BPM => clamped to 40.
        mocks.getBufferForClip.mockReturnValue({
            buffer: makeBuffer([0, 2500, 5000, 7500, 10000]),
            audioBufferId: 'b1',
        });

        expect(await subject.detectTempo('c1')).toBe(40);
    });

    it('resists outlier intervals by taking the median rather than the mean', async () => {
        // Mostly 0.5s (120 BPM) with one long gap; median must stay 120.
        mocks.getBufferForClip.mockReturnValue({
            buffer: makeBuffer([0, 500, 1000, 5000, 5500, 6000]),
            audioBufferId: 'b1',
        });

        expect(await subject.detectTempo('c1')).toBe(120);
    });
});
