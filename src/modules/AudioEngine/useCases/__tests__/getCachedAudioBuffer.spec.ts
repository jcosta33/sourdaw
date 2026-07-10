import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCachedAudioBuffer } from '../getCachedAudioBuffer';

const mocks = vi.hoisted(() => ({
    audioBufferCacheGet: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: mocks.audioBufferCacheGet,
    },
}));

const create_test_audio_buffer = (): AudioBuffer => {
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
};

describe('getCachedAudioBuffer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return the cached AudioBuffer for the requested id', () => {
        const buffer = create_test_audio_buffer();
        mocks.audioBufferCacheGet.mockReturnValue(buffer);

        const result = getCachedAudioBuffer({ bufferId: 'clip-1' });

        expect(result).toBe(buffer);
        expect(mocks.audioBufferCacheGet).toHaveBeenCalledWith('clip-1');
    });

    it('should return null when no cached AudioBuffer exists', () => {
        mocks.audioBufferCacheGet.mockReturnValue(undefined);

        const result = getCachedAudioBuffer({ bufferId: 'missing-buffer' });

        expect(result).toBeNull();
        expect(mocks.audioBufferCacheGet).toHaveBeenCalledWith('missing-buffer');
    });
});
