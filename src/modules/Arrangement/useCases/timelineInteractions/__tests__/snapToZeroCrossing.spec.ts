import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { snapToZeroCrossing } from '../snapToZeroCrossing';

import type { SnapSplitBeatToZeroCrossingInput } from '../../../services/snapSplitBeatToZeroCrossing';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn(),
    snapSplitBeatToZeroCrossing: vi.fn(),
    transportStore: { value: null as { tempo: number } | null },
    clipStartTempo: null as number | null,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('#/modules/Transport/stores', () => ({
    DEFAULT_TEMPO_BPM: 120,
    transportStore: mocks.transportStore,
    readTempoAtBeat: ({ beat }: { beat: number }) =>
        (beat === 4 ? mocks.clipStartTempo : null) ?? mocks.transportStore.value?.tempo ?? 120,
}));

vi.mock('../../../services/snapSplitBeatToZeroCrossing', () => ({
    snapSplitBeatToZeroCrossing: mocks.snapSplitBeatToZeroCrossing,
}));

describe('snapToZeroCrossing use case', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.transportStore.value = null;
        mocks.clipStartTempo = null;
    });

    it('returns unchanged for non-audio clips without reading the audio cache', () => {
        const clip = ClipDummy.create({ type: 'midi' });

        expect(snapToZeroCrossing(clip, 2.5)).toBe(2.5);
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.snapSplitBeatToZeroCrossing).not.toHaveBeenCalled();
    });

    it('reads cached audio and tempo before invoking the pure calculation', () => {
        const clip = ClipDummy.create({ type: 'audio', audioBufferId: 'buf-1' });
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
        mocks.transportStore.value = { tempo: 60 };
        mocks.snapSplitBeatToZeroCrossing.mockReturnValue(1.5);

        expect(snapToZeroCrossing(clip, 2)).toBe(1.5);

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(audioBuffer.getChannelData).toHaveBeenCalledWith(0);
        expect(mocks.snapSplitBeatToZeroCrossing).toHaveBeenCalledWith({
            clip,
            splitBeat: 2,
            channelData,
            sampleRate: 48000,
            tempo: 60,
        } satisfies SnapSplitBeatToZeroCrossingInput);
    });

    it('passes tempo at the clip start when it differs from project tempo', () => {
        const clip = ClipDummy.create({ type: 'audio', audioBufferId: 'buf-1', startBeat: 4, audioOffsetBeats: 1 });
        const channelData = new Float32Array([1, -1]);
        mocks.getCachedAudioBuffer.mockReturnValue({ getChannelData: () => channelData, sampleRate: 100 });
        mocks.transportStore.value = { tempo: 120 };
        mocks.clipStartTempo = 90;
        mocks.snapSplitBeatToZeroCrossing.mockReturnValue(5);

        expect(snapToZeroCrossing(clip, 5)).toBe(5);
        expect(mocks.snapSplitBeatToZeroCrossing).toHaveBeenCalledWith(
            expect.objectContaining({ clip, splitBeat: 5, tempo: 90 })
        );
    });

    it('returns unchanged when the referenced audio is not cached', () => {
        const clip = ClipDummy.create({ type: 'audio', audioBufferId: 'missing' });
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        expect(snapToZeroCrossing(clip, 2.5)).toBe(2.5);
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing' });
        expect(mocks.snapSplitBeatToZeroCrossing).not.toHaveBeenCalled();
    });

    it('falls back to a 120 BPM default when the transport store has no tempo', () => {
        const clip = ClipDummy.create({ type: 'audio', audioBufferId: 'buf-1' });
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
        // Transport store present but missing a tempo field — must fall back
        // to the 120 BPM hard-coded default rather than forwarding undefined.
        mocks.transportStore.value = { tempo: undefined } as unknown as { tempo: number };
        mocks.snapSplitBeatToZeroCrossing.mockReturnValue(2.25);

        expect(snapToZeroCrossing(clip, 2)).toBe(2.25);

        expect(mocks.snapSplitBeatToZeroCrossing).toHaveBeenCalledWith({
            clip,
            splitBeat: 2,
            channelData,
            sampleRate: 48000,
            tempo: 120,
        } satisfies SnapSplitBeatToZeroCrossingInput);
    });
});
