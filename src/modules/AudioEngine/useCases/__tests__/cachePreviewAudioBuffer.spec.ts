import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cachePreviewAudioBuffer } from '../cachePreviewAudioBuffer';

const mocks = vi.hoisted(() => ({
    audioBufferCacheSet: vi.fn(),
    createBuffer: vi.fn(),
    getChannelData: vi.fn(),
    channelData: new Float32Array(0),
    buffer: {
        getChannelData: vi.fn(),
    },
}));

vi.mock('../engineAccess/getAudioContext', () => ({
    getAudioContext: vi.fn(() => ({
        createBuffer: mocks.createBuffer,
    })),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        set: mocks.audioBufferCacheSet,
    },
}));

describe('cachePreviewAudioBuffer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.channelData = new Float32Array(3);
        mocks.getChannelData.mockReturnValue(mocks.channelData);
        mocks.buffer.getChannelData = mocks.getChannelData;
        mocks.createBuffer.mockReturnValue(mocks.buffer);
    });

    it('should create a mono AudioBuffer, copy channel data, cache it, and return its id', () => {
        const audio = new Float32Array([0.25, -0.5, 0.75]);

        const bufferId = cachePreviewAudioBuffer({ audio, sampleRate: 48_000 });

        expect(bufferId).toMatch(/^ai-render-/);
        expect(mocks.createBuffer).toHaveBeenCalledWith(1, audio.length, 48_000);
        expect(mocks.getChannelData).toHaveBeenCalledWith(0);
        expect(Array.from(mocks.channelData)).toEqual(Array.from(audio));
        expect(mocks.audioBufferCacheSet).toHaveBeenCalledWith(bufferId, mocks.buffer);
    });
});
