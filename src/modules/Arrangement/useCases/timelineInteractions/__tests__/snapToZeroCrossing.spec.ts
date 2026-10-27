import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { liveTempoTimeline } from '../../liveTempoTimeline';
import { resolveZeroCrossingPosition, snapToZeroCrossing } from '../snapToZeroCrossing';

import type { SnapSplitBeatToZeroCrossingInput } from '../../../services/snapSplitBeatToZeroCrossing';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn(),
    snapSplitBeatToZeroCrossing: vi.fn(),
    readSecondsAtBeat: vi.fn(),
    readBeatAtSamples: vi.fn(),
    readTempoAtBeat: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('#/modules/Transport/stores', () => ({
    readSecondsAtBeat: mocks.readSecondsAtBeat,
    readBeatAtSamples: mocks.readBeatAtSamples,
    readTempoAtBeat: mocks.readTempoAtBeat,
}));

vi.mock('../../../services/snapSplitBeatToZeroCrossing', () => ({
    snapSplitPositionToZeroCrossing: mocks.snapSplitBeatToZeroCrossing,
}));

describe('snapToZeroCrossing use case', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([{ type: 'midi' as const }, { audioBufferId: undefined }])(
        'returns unchanged without reading the audio cache for an ineligible clip: %o',
        (overrides) => {
            const clip = ClipDummy.create(overrides);

            expect(snapToZeroCrossing(clip, 2.5)).toBe(2.5);
            expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
            expect(mocks.snapSplitBeatToZeroCrossing).not.toHaveBeenCalled();
        }
    );

    it('passes cached audio and the live integrated timeline to the pure calculation', () => {
        const clip = ClipDummy.create({ audioBufferId: 'buf-1' });
        const channelData = new Float32Array([1, -1]);
        const audioBuffer: AudioBuffer = {
            copyFromChannel: vi.fn(),
            copyToChannel: vi.fn(),
            duration: 1,
            getChannelData: vi.fn(() => channelData),
            length: channelData.length,
            numberOfChannels: 1,
            sampleRate: 48000,
        };
        mocks.getCachedAudioBuffer.mockReturnValue(audioBuffer);
        mocks.snapSplitBeatToZeroCrossing.mockReturnValue({ beat: 1.5 });

        expect(snapToZeroCrossing(clip, 2)).toBe(1.5);

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(audioBuffer.getChannelData).toHaveBeenCalledWith(0);
        expect(mocks.snapSplitBeatToZeroCrossing).toHaveBeenCalledWith({
            clip,
            splitBeat: 2,
            channelData,
            sampleRate: 48000,
            timeline: liveTempoTimeline,
            stretchRatio: 1,
        } satisfies SnapSplitBeatToZeroCrossingInput);

        mocks.readSecondsAtBeat.mockReturnValue(0.625);
        mocks.readBeatAtSamples.mockReturnValue(1.5);
        mocks.readTempoAtBeat.mockReturnValue(240);
        expect(liveTempoTimeline.secondsAtBeat(1.5)).toBe(0.625);
        expect(liveTempoTimeline.beatAtSeconds(0.625)).toBe(1.5);
        expect(liveTempoTimeline.tempoAtBeat(1.5)).toBe(240);
        expect(mocks.readSecondsAtBeat).toHaveBeenCalledWith({ beat: 1.5 });
        expect(mocks.readBeatAtSamples).toHaveBeenCalledWith({ samples: 0.625, sampleRate: 1 });
        expect(mocks.readTempoAtBeat).toHaveBeenCalledWith({ beat: 1.5 });
    });

    it.each([
        { mode: 'off' as const, ratio: 2, expected: 1 },
        { mode: 'repitch' as const, ratio: 2, expected: 2 },
        { mode: 'timestretch' as const, ratio: 0, expected: 0.01 },
        { mode: 'repitch' as const, ratio: 200, expected: 100 },
    ])('uses the consumed stretch rate for $mode ratio $ratio', ({ mode, ratio, expected }) => {
        const clip = ClipDummy.create({ stretchMode: mode, stretchRatio: ratio });
        mocks.getCachedAudioBuffer.mockReturnValue({
            getChannelData: () => new Float32Array([1, -1]),
            sampleRate: 48000,
        });
        mocks.snapSplitBeatToZeroCrossing.mockReturnValue({ beat: 2 });

        expect(snapToZeroCrossing(clip, 2)).toBe(2);
        expect(mocks.snapSplitBeatToZeroCrossing).toHaveBeenCalledWith(
            expect.objectContaining({ clip, splitBeat: 2, timeline: liveTempoTimeline, stretchRatio: expected })
        );
    });

    it('returns unchanged when the referenced audio is not cached', () => {
        const clip = ClipDummy.create({ audioBufferId: 'missing' });
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        expect(snapToZeroCrossing(clip, 2.5)).toBe(2.5);
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing' });
        expect(mocks.snapSplitBeatToZeroCrossing).not.toHaveBeenCalled();
    });

    it('retains a selected source sample and uses the captured preparation timeline', () => {
        const clip = ClipDummy.create();
        const timeline = {
            secondsAtBeat: vi.fn(),
            beatAtSeconds: vi.fn(),
            tempoAtBeat: vi.fn(),
        };
        const position = { beat: 2.5000416666666663, sourceSeconds: 108002 / 48000 };
        mocks.getCachedAudioBuffer.mockReturnValue({
            getChannelData: () => new Float32Array([1, -1]),
            sampleRate: 48000,
        });
        mocks.snapSplitBeatToZeroCrossing.mockReturnValue(position);

        expect(resolveZeroCrossingPosition(clip, 2.5, timeline)).toBe(position);
        expect(mocks.snapSplitBeatToZeroCrossing).toHaveBeenCalledWith(expect.objectContaining({ timeline }));
        expect(snapToZeroCrossing(clip, 2.5)).toBe(position.beat);
    });
});
