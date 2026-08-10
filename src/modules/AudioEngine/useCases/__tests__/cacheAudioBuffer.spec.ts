import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheAudioBuffer } from '../cacheAudioBuffer';

const mocks = vi.hoisted(() => ({
    audioBufferCacheSet: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        set: mocks.audioBufferCacheSet,
    },
}));

describe('cacheAudioBuffer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should cache an existing AudioBuffer and return the generated id', () => {
        const channel_data = new Float32Array(128);
        const buffer: AudioBuffer = {
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

        const bufferId = cacheAudioBuffer({ buffer });

        expect(bufferId).toMatch(/^generated-/);
        expect(mocks.audioBufferCacheSet).toHaveBeenCalledWith(bufferId, buffer);
    });

    it('should preserve a provided deterministic buffer id', () => {
        const channel_data = new Float32Array(128);
        const buffer: AudioBuffer = {
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

        const bufferId = cacheAudioBuffer({ buffer, bufferId: 'clip-1-vocals', freezeProjectId: 200 });

        expect(bufferId).toBe('clip-1-vocals');
        expect(mocks.audioBufferCacheSet).toHaveBeenCalledWith('clip-1-vocals', buffer, { freezeProjectId: 200 });
    });
});
