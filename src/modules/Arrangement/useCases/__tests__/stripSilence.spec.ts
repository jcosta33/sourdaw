import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../models/Track';
import { type TrackState } from '../../repositories/track/getTrackState';
import { stripSilence } from '../stripSilence';

type UpdateTrackFn = (track_id: string, updater: (track: Track) => Track) => void;

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => AudioBuffer | null>(),
    getTrackState: vi.fn<() => TrackState | null>(),
    updateTrack: vi.fn<UpdateTrackFn>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

function create_track_with_clips(clips: Clip[]): Track {
    return TrackDummy.create({
        id: 'track-1',
        clips,
    });
}

function create_track_state(track: Track): TrackState {
    return {
        tracks: [track],
        selectedTrackId: 'track-1',
        ghostClips: [],
    };
}

function create_test_audio_buffer(channel_data: Float32Array): AudioBuffer {
    const sample_rate = 100;
    return {
        copyFromChannel: (destination, _channel_number, start_in_channel = 0) => {
            destination.set(channel_data.subarray(start_in_channel, start_in_channel + destination.length));
        },
        copyToChannel: (source, _channel_number, start_in_channel = 0) => {
            channel_data.set(source, start_in_channel);
        },
        duration: channel_data.length / sample_rate,
        getChannelData: () => channel_data,
        length: channel_data.length,
        numberOfChannels: 1,
        sampleRate: sample_rate,
    };
}

describe('stripSilence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should not read the cache or update when track state is missing', () => {
        mocks.getTrackState.mockReturnValue(null);

        stripSilence('clip-1');

        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('should not read the cache or update when the clip is missing', () => {
        const clip = ClipDummy.create({ id: 'other-clip', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(create_track_state(create_track_with_clips([clip])));

        stripSilence('clip-1');

        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('should not read the cache or update when the clip is not audio', () => {
        const clip = ClipDummy.create({ id: 'clip-1', type: 'midi', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(create_track_state(create_track_with_clips([clip])));

        stripSilence('clip-1');

        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('should not read the cache or update when the audio clip has no buffer id', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: undefined });
        mocks.getTrackState.mockReturnValue(create_track_state(create_track_with_clips([clip])));

        stripSilence('clip-1');

        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('should read through AudioEngine and not update when the owner cache has no buffer', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(create_track_state(create_track_with_clips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        stripSilence('clip-1');

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('should read through AudioEngine and not update when audio has one sound region', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1' });
        const channel_data = new Float32Array(100).fill(0.5);
        mocks.getTrackState.mockReturnValue(create_track_state(create_track_with_clips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer(channel_data));

        stripSilence('clip-1');

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('should split multi-region audio and update the owning track', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buf-1',
            startBeat: 0,
            endBeat: 10,
        });
        const track = create_track_with_clips([clip]);
        const channel_data = new Float32Array(100);
        channel_data.fill(0.5, 0, 20);
        channel_data.fill(0.5, 60, 100);
        mocks.getTrackState.mockReturnValue(create_track_state(track));
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer(channel_data));

        stripSilence('clip-1');

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(mocks.updateTrack).toHaveBeenCalledWith('track-1', expect.any(Function));

        const updater = mocks.updateTrack.mock.calls[0]?.[1];
        if (!updater) {
            throw new Error('Expected stripSilence to pass an updater to updateTrack');
        }

        const updated_track = updater(track);

        expect(updated_track.clips).toHaveLength(2);
        expect(updated_track.clips).toEqual([
            expect.objectContaining({
                audioBufferId: 'buf-1',
                endBeat: 2,
                id: expect.stringMatching(/^clip-strip-/),
                startBeat: 0,
            }),
            expect.objectContaining({
                audioBufferId: 'buf-1',
                endBeat: 10,
                id: expect.stringMatching(/^clip-strip-/),
                startBeat: 6,
            }),
        ]);
        expect(updated_track.clips.map((context) => context.id)).not.toContain('clip-1');
    });
});
