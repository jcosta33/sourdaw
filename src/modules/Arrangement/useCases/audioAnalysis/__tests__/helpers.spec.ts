import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { getBufferForClip } from '../helpers';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => AudioBuffer | null>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

function create_test_audio_buffer(): AudioBuffer {
    const channel_data = new Float32Array(128);
    return {
        copyFromChannel: (destination, _channel_number, start_in_channel = 0) => {
            destination.set(channel_data.subarray(start_in_channel, start_in_channel + destination.length));
        },
        copyToChannel: (source, _channel_number, start_in_channel = 0) => {
            channel_data.set(source, start_in_channel);
        },
        duration: channel_data.length / 48_000,
        getChannelData: () => channel_data,
        length: channel_data.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

function set_track_store_with_clip(clip: Clip): void {
    trackStore.set({
        tracks: [TrackDummy.create({ clips: [clip] })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
}

describe('getBufferForClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('should return the cached buffer and id for an audio clip', () => {
        const buffer = create_test_audio_buffer();
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1' });
        set_track_store_with_clip(clip);
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);

        const result = getBufferForClip('clip-1');

        expect(result).toEqual({ buffer, audioBufferId: 'buf-1' });
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
    });

    it('should return null when the owner cache has no buffer', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1' });
        set_track_store_with_clip(clip);
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        const result = getBufferForClip('clip-1');

        expect(result).toBeNull();
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
    });

    it('should return null without reading cache when the track is missing', () => {
        const result = getBufferForClip('missing-clip');

        expect(result).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('should return null without reading cache when the clip is missing', () => {
        const other_clip = ClipDummy.create({ id: 'other-clip', audioBufferId: 'buf-1' });
        set_track_store_with_clip(other_clip);

        const result = getBufferForClip('missing-clip');

        expect(result).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('should return null without reading cache when the clip is not audio', () => {
        const clip = ClipDummy.create({ id: 'clip-1', type: 'midi', audioBufferId: 'buf-1' });
        set_track_store_with_clip(clip);

        const result = getBufferForClip('clip-1');

        expect(result).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('should return null without reading cache when the audio clip has no buffer id', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: undefined });
        set_track_store_with_clip(clip);

        const result = getBufferForClip('clip-1');

        expect(result).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });
});
