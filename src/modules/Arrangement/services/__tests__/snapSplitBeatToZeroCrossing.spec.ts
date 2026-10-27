import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { snapSplitBeatToZeroCrossing } from '../snapSplitBeatToZeroCrossing';

function constantTimeline(tempo: number): TempoTimeline {
    return {
        secondsAtBeat: (beat) => (beat * 60) / tempo,
        beatAtSeconds: (seconds) => (seconds * tempo) / 60,
        tempoAtBeat: () => tempo,
    };
}

const changingTimeline: TempoTimeline = {
    secondsAtBeat: (beat) => {
        if (beat <= 1) return beat / 2;
        if (beat <= 2) return 0.5 + (beat - 1) / 4;
        return 0.75 + (beat - 2) / 2;
    },
    beatAtSeconds: (seconds) => {
        if (seconds <= 0.5) return seconds * 2;
        if (seconds <= 0.75) return 1 + (seconds - 0.5) * 4;
        return 2 + (seconds - 0.75) * 2;
    },
    tempoAtBeat: (beat) => (beat >= 1 && beat < 2 ? 240 : 120),
};

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
                timeline: constantTimeline(120),
                stretchRatio: 1,
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
            timeline: constantTimeline(120),
            stretchRatio: 1,
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
            timeline: constantTimeline(60),
            stretchRatio: 1,
        });

        expect(result).toBeCloseTo(3.48, 10);
    });

    it('looks up canonical source seconds and inverts the integrated tempo map', () => {
        const clip = ClipDummy.create({ audioOffsetSeconds: 0.25, audioOffsetBeats: 0.5 });

        const result = snapSplitBeatToZeroCrossing({
            clip,
            splitBeat: 1.5,
            channelData: createSamples(96000, 42002),
            sampleRate: 48000,
            timeline: changingTimeline,
            stretchRatio: 1,
        });

        // At beat 1.5, .625 song seconds plus .25 source seconds selects frame 42000.
        expect(result).toBeCloseTo(1.5 + 8 / 48000, 12);
    });

    it('uses the consumed rate in both directions across tempo changes', () => {
        const clip = ClipDummy.create({ audioOffsetSeconds: 0.25, audioOffsetBeats: 0.5 });

        const result = snapSplitBeatToZeroCrossing({
            clip,
            splitBeat: 2.5,
            channelData: createSamples(144000, 108002),
            sampleRate: 48000,
            timeline: changingTimeline,
            stretchRatio: 2,
        });

        expect(result).toBeCloseTo(2.5 + 2 / 48000, 12);
    });

    it('keeps canonical zero authoritative over a stale legacy offset', () => {
        const clip = ClipDummy.create({ audioOffsetSeconds: 0, audioOffsetBeats: 10 });

        expect(
            snapSplitBeatToZeroCrossing({
                clip,
                splitBeat: 1,
                channelData: createSamples(48000, 24002),
                sampleRate: 48000,
                timeline: constantTimeline(120),
                stretchRatio: 1,
            })
        ).toBeCloseTo(1 + 4 / 48000, 12);
    });

    it('retains the selected loop occurrence when a source sample repeats', () => {
        const clip = ClipDummy.create({
            endBeat: 8,
            audioOffsetSeconds: 0.25,
            loopEnabled: true,
            loopLength: 2,
        });

        expect(
            snapSplitBeatToZeroCrossing({
                clip,
                splitBeat: 4.5,
                channelData: createSamples(96000, 24002),
                sampleRate: 48000,
                timeline: constantTimeline(120),
                stretchRatio: 1,
            })
        ).toBeCloseTo(4.5 + 4 / 48000, 12);
    });

    it('excludes a sign pair crossing the next loop seam while retaining a valid nearby pair', () => {
        const channelData = new Float32Array(96000).fill(1);
        channelData.fill(-1, 59999, 60001);
        const clip = ClipDummy.create({ audioOffsetSeconds: 0.25, loopEnabled: true, loopLength: 2 });

        expect(
            snapSplitBeatToZeroCrossing({
                clip,
                splitBeat: 1.99998,
                channelData,
                sampleRate: 48000,
                timeline: constantTimeline(120),
                stretchRatio: 1,
            })
        ).toBeCloseTo(2 - 4 / 48000, 12);
    });

    it('excludes a sign pair before the selected loop seam', () => {
        const channelData = new Float32Array(96000).fill(1);
        channelData.fill(-1, 12000, 12003);
        const clip = ClipDummy.create({ audioOffsetSeconds: 0.25, loopEnabled: true, loopLength: 2 });

        expect(
            snapSplitBeatToZeroCrossing({
                clip,
                splitBeat: 2.00002,
                channelData,
                sampleRate: 48000,
                timeline: constantTimeline(120),
                stretchRatio: 1,
            })
        ).toBeCloseTo(2 + 4 / 48000, 12);
    });

    it('advances through signed pre-roll without snapping its silent interval to sample zero', () => {
        const clip = ClipDummy.create({ audioOffsetSeconds: -0.25 });
        const input = {
            clip,
            channelData: createSamples(48000, 6002),
            sampleRate: 48000,
            timeline: constantTimeline(120),
            stretchRatio: 1,
        };

        expect(snapSplitBeatToZeroCrossing({ ...input, splitBeat: 0.25 })).toBe(0.25);
        expect(snapSplitBeatToZeroCrossing({ ...input, splitBeat: 0.75 })).toBeCloseTo(0.75 + 4 / 48000, 12);
    });

    it('keeps an unsnapped sub-sample beat exact when the source has no crossing', () => {
        expect(
            snapSplitBeatToZeroCrossing({
                clip: ClipDummy.create(),
                splitBeat: 1.00001,
                channelData: new Float32Array(48000).fill(1),
                sampleRate: 48000,
                timeline: constantTimeline(120),
                stretchRatio: 1,
            })
        ).toBe(1.00001);
    });

    it('snaps to an actual sign pair at the rounded target sample', () => {
        expect(
            snapSplitBeatToZeroCrossing({
                clip: ClipDummy.create(),
                splitBeat: 1.00001,
                channelData: createSamples(48000, 24000),
                sampleRate: 48000,
                timeline: constantTimeline(120),
                stretchRatio: 1,
            })
        ).toBe(1);
    });

    it.each([
        { name: 'empty media', samples: new Float32Array(), source: 0, beat: 1 },
        { name: 'media end', samples: createSamples(48000, 47998), source: 0, beat: 2 },
        { name: 'past media end', samples: createSamples(48000, 47998), source: 0, beat: 2.00001 },
        { name: 'invalid canonical entry', samples: createSamples(48000, 24002), source: NaN, beat: 1 },
    ])('returns unchanged for $name', ({ samples, source, beat }) => {
        expect(
            snapSplitBeatToZeroCrossing({
                clip: ClipDummy.create({ audioOffsetSeconds: source }),
                splitBeat: beat,
                channelData: samples,
                sampleRate: 48000,
                timeline: constantTimeline(120),
                stretchRatio: 1,
            })
        ).toBe(beat);
    });
});
