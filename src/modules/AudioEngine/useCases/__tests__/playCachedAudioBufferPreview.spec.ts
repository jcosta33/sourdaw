import { beforeEach, describe, expect, it, vi } from 'vitest';

import { playCachedAudioBufferPreview } from '../playCachedAudioBufferPreview';

const mocks = vi.hoisted(() => ({
    audioBufferCacheGet: vi.fn(),
    createBufferSource: vi.fn(),
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    destination: {},
    buffer: {},
    source: {
        buffer: null as unknown,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as unknown,
    },
}));

vi.mock('../scheduling/createBufferSource', () => ({
    createBufferSource: mocks.createBufferSource,
}));

vi.mock('../engineAccess/getAudioContext', () => ({
    getAudioContext: vi.fn(() => ({
        destination: mocks.destination,
    })),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: mocks.audioBufferCacheGet,
    },
}));

describe('playCachedAudioBufferPreview', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.source = {
            buffer: null,
            connect: mocks.connect,
            start: mocks.start,
            stop: mocks.stop,
            onended: null,
        };
        mocks.createBufferSource.mockReturnValue(mocks.source);
    });

    it('should no-op when the cached buffer is missing', () => {
        mocks.audioBufferCacheGet.mockReturnValue(undefined);

        const result = playCachedAudioBufferPreview({
            bufferId: 'missing-buffer',
            onEnded: vi.fn(),
        });

        expect(result).toBeNull();
        expect(mocks.createBufferSource).not.toHaveBeenCalled();
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it('should start the cached buffer preview and return a stop handle', () => {
        const onEnded = vi.fn();
        mocks.audioBufferCacheGet.mockReturnValue(mocks.buffer);

        const result = playCachedAudioBufferPreview({
            bufferId: 'preview-buffer',
            onEnded,
        });

        expect(result).not.toBeNull();
        expect(mocks.audioBufferCacheGet).toHaveBeenCalledWith('preview-buffer');
        expect(mocks.source?.buffer).toBe(mocks.buffer);
        expect(mocks.connect).toHaveBeenCalledWith(mocks.destination);
        expect(mocks.source?.onended).toBe(onEnded);
        expect(mocks.start).toHaveBeenCalledTimes(1);
        result?.stop();
        expect(mocks.stop).toHaveBeenCalledTimes(1);
    });
});
