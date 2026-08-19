import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../models/Track';
import { type TrackState } from '../../repositories/track/getTrackState';
import { prepareStripSilence } from '../prepareStripSilence';

const mocks = vi.hoisted(() => ({
    getAutomationLanes: vi.fn(() => []),
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => AudioBuffer | null>(),
    getTrackState: vi.fn<() => TrackState | null>(),
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationLanes: mocks.getAutomationLanes,
}));

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

function createTrackWithClips(clips: Clip[]): Track {
    return TrackDummy.create({ id: 'track-1', clips });
}

function createTrackState(track: Track): TrackState {
    return { tracks: [track], selectedTrackId: 'track-1', ghostClips: [] };
}

function createTestAudioBuffer(channelData: Float32Array<ArrayBuffer>): AudioBuffer {
    const sampleRate = 100;
    return {
        copyFromChannel: (destination, _channelNumber, startInChannel = 0) => {
            destination.set(channelData.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source, _channelNumber, startInChannel = 0) => {
            channelData.set(source, startInChannel);
        },
        duration: channelData.length / sampleRate,
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 1,
        sampleRate,
    } as AudioBuffer;
}

describe('prepareStripSilence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAutomationLanes.mockReturnValue([]);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            clipId: 'clip-1',
        });
    });

    it('returns null when track state is missing', () => {
        mocks.getTrackState.mockReturnValue(null);

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('returns null when the clip is missing', () => {
        const clip = ClipDummy.create({ id: 'other-clip', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('returns null when the clip is not audio', () => {
        const clip = ClipDummy.create({ id: 'clip-1', type: 'midi', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('returns null when the audio clip has no buffer id', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: undefined });
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('returns null when the owner cache has no buffer', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
    });

    it('returns null when the audio has only one sound region', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1' });
        const channelData = new Float32Array(100).fill(0.5) as Float32Array<ArrayBuffer>;
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
    });

    it('splits multi-region audio into a before/after snapshot', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1', startBeat: 0, endBeat: 10 });
        const track = createTrackWithClips([clip]);
        const channelData = new Float32Array(100) as Float32Array<ArrayBuffer>;
        channelData.fill(0.5, 0, 20);
        channelData.fill(0.5, 60, 100);
        mocks.getTrackState.mockReturnValue(createTrackState(track));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1' });

        expect(plan).not.toBeNull();
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(plan!.next.clips).toEqual([
            expect.objectContaining({ audioBufferId: 'buf-1', endBeat: 2, startBeat: 0 }),
            expect.objectContaining({ audioBufferId: 'buf-1', endBeat: 10, startBeat: 6 }),
        ]);
        expect(plan!.next.clips.map((clip) => clip.id)).not.toContain('clip-1');
        expect(plan!.previous.clips).toEqual([expect.objectContaining({ id: 'clip-1' })]);
        expect(plan!.newClipIds).toHaveLength(2);
    });

    it('merges adjacent regions whose silence gap is below minSilenceBeats', () => {
        // clipDurationBeats = 10 over 100 samples -> 0.1 beats/sample.
        // Regions: loud 0-19, 22-41 (gap of 2 samples = 0.2 beats < 0.5 merges),
        //          then a large 40-sample gap (4 beats, not merged) to loud 82-99.
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1', startBeat: 0, endBeat: 10 });
        const channelData = new Float32Array(100) as Float32Array<ArrayBuffer>;
        channelData.fill(0.5, 0, 20);
        channelData.fill(0.5, 22, 42);
        channelData.fill(0.5, 82, 100);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1' });

        expect(plan).not.toBeNull();
        // 3 detected regions, but the first two (gap 0.2 beats) merged -> 2 clips.
        expect(plan!.next.clips).toHaveLength(2);
    });

    it('returns null when every silence gap is below minSilenceBeats (all regions merge into one)', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1', startBeat: 0, endBeat: 10 });
        const channelData = new Float32Array(100) as Float32Array<ArrayBuffer>;
        channelData.fill(0.5, 0, 20);
        channelData.fill(0.5, 22, 42);
        channelData.fill(0.5, 45, 65);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
    });

    it('rejects an ineligible owner before buffer scanning or UUID allocation', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(randomUuid).not.toHaveBeenCalled();
    });

    it('derives the peak-detection window from the buffer sample rate, not a fixed sample count (regression #2108)', () => {
        // At sampleRate 100 the window is floor(100 * 0.01) = 1 sample, so two
        // narrow blips 45 samples apart must register as two regions. A
        // window hardcoded to the buffer's own length (100) would run only
        // one peak-detection pass over the whole buffer and see one region.
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1', startBeat: 0, endBeat: 10 });
        const channelData = new Float32Array(100) as Float32Array<ArrayBuffer>;
        channelData.fill(0.5, 0, 5);
        channelData.fill(0.5, 50, 55);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1', minDuration: 0 });

        expect(plan).not.toBeNull();
        expect(plan!.next.clips).toHaveLength(2);
    });
});
