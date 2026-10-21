import { describe, expect, it } from 'vitest';

import {
    defaultTransportState,
    readBeatAtSamples,
    readSecondsAtBeat,
    tempoMapStore,
    transportStore,
} from '#/modules/Transport/stores';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { snapSplitBeatToZeroCrossing } from '../snapSplitBeatToZeroCrossing';

function createSamples(length: number, crossingSample: number): Float32Array {
    const samples = new Float32Array(length).fill(1);
    samples.fill(-1, crossingSample + 1);
    return samples;
}

function flatTiming(tempo: number): {
    secondsAtBeat: (beat: number) => number;
    beatAtSeconds: (seconds: number) => number;
} {
    return {
        secondsAtBeat: (beat) => (beat * 60) / tempo,
        beatAtSeconds: (seconds) => (seconds * tempo) / 60,
    };
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
                ...flatTiming(120),
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
            ...flatTiming(120),
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
            ...flatTiming(60),
        });

        expect(result).toBeCloseTo(3.48, 10);
    });

    it('returns the song-time beat of a crossing after an interior tempo marker', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        try {
            const clip = ClipDummy.create({
                type: 'audio',
                audioBufferId: 'buf-1',
                startBeat: 0,
                endBeat: 8,
                audioOffsetBeats: 2,
                audioOffsetSeconds: 0,
            });
            const input = {
                clip,
                splitBeat: 5,
                channelData: createSamples(500, 320),
                sampleRate: 100,
                tempo: 120,
                secondsAtBeat: (beat: number) => readSecondsAtBeat({ beat }),
                beatAtSeconds: (seconds: number) => readBeatAtSamples({ samples: seconds, sampleRate: 1 }),
            };

            expect(snapSplitBeatToZeroCrossing(input)).toBeCloseTo(5.2, 10);
        } finally {
            tempoMapStore.set({ changes: [] });
            transportStore.set(defaultTransportState);
        }
    });

    it('snaps backward through an interior marker using the same source sample inverse', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        try {
            const clip = ClipDummy.create({
                type: 'audio',
                audioBufferId: 'buf-1',
                startBeat: 0,
                endBeat: 8,
                audioOffsetSeconds: 0,
            });
            expect(
                snapSplitBeatToZeroCrossing({
                    clip,
                    splitBeat: 5.2,
                    channelData: createSamples(500, 300),
                    sampleRate: 100,
                    tempo: 120,
                    secondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
                    beatAtSeconds: (seconds) => readBeatAtSamples({ samples: seconds, sampleRate: 1 }),
                })
            ).toBeCloseTo(5, 10);
        } finally {
            tempoMapStore.set({ changes: [] });
            transportStore.set(defaultTransportState);
        }
    });

    it('inverts a ramp but refuses a crossing at the current loop boundary', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({
            changes: [
                { id: 'ramp', beat: 0, tempo: 120, curve: 'linear' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        try {
            const clip = ClipDummy.create({
                type: 'audio',
                audioBufferId: 'buf-1',
                startBeat: 0,
                endBeat: 8,
                audioOffsetSeconds: 0,
            });
            const timing = {
                secondsAtBeat: (beat: number) => readSecondsAtBeat({ beat }),
                beatAtSeconds: (seconds: number) => readBeatAtSamples({ samples: seconds, sampleRate: 1 }),
            };
            expect(
                snapSplitBeatToZeroCrossing({
                    clip,
                    splitBeat: 2,
                    channelData: createSamples(500, 150),
                    sampleRate: 100,
                    tempo: 120,
                    ...timing,
                })
            ).toBeCloseTo(8 * (1 - Math.exp(-1.5 / 4)), 10);

            const looped = { ...clip, loopEnabled: true, loopLength: 4 };
            expect(
                snapSplitBeatToZeroCrossing({
                    clip: looped,
                    splitBeat: 4.1,
                    channelData: createSamples(500, 0),
                    sampleRate: 100,
                    tempo: 120,
                    ...timing,
                })
            ).toBe(4.1);
        } finally {
            tempoMapStore.set({ changes: [] });
            transportStore.set(defaultTransportState);
        }
    });
});
