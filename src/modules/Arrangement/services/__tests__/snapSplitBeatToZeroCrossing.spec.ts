import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { snapSplitBeatToZeroCrossing } from '../snapSplitBeatToZeroCrossing';

function createSamples(length: number, crossingSample: number): Float32Array {
    const samples = new Float32Array(length).fill(1);
    samples.fill(-1, crossingSample + 1);
    return samples;
}

describe('snapSplitBeatToZeroCrossing', () => {
    it('returns the original split beat for non-audio clips', () => {
        const clip = ClipDummy.create({ type: 'midi' });

        expect(
            snapSplitBeatToZeroCrossing({
                clip,
                splitBeat: 2.5,
                channelData: new Float32Array([1, -1]),
                sampleRate: 10,
                tempo: 120,
            })
        ).toBe(2.5);
    });

    it('uses explicit tempo and sample rate for zero-crossing selection', () => {
        const clip = ClipDummy.create({
            type: 'audio',
            audioBufferId: 'buf-1',
            startBeat: 1,
        });
        const result = snapSplitBeatToZeroCrossing({
            clip,
            splitBeat: 2.1,
            channelData: createSamples(100, 53),
            sampleRate: 100,
            tempo: 120,
        });

        expect(result).toBeCloseTo(2.06, 10);
    });

    it('preserves the clip audio offset when converting the snapped sample', () => {
        const clip = ClipDummy.create({
            type: 'audio',
            audioBufferId: 'buf-1',
            startBeat: 2,
            audioOffsetBeats: 0.5,
        });

        const result = snapSplitBeatToZeroCrossing({
            clip,
            splitBeat: 3.5,
            channelData: createSamples(260, 198),
            sampleRate: 100,
            tempo: 60,
        });

        expect(result).toBeCloseTo(3.48, 10);
    });
});
