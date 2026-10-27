import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAudioPreviewIntents } from '../../services/audioPreview/createAudioPreviewIntents';
import { playCachedAudioBufferPreview } from '../playCachedAudioBufferPreview';

type Source = {
    buffer: unknown;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
};

let owner = createAudioPreviewIntents();

const mocks = vi.hoisted(() => {
    const source: Source = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
    };
    return {
        audioBufferCacheGet: vi.fn(),
        createBufferSource: vi.fn(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        beginAudioPreviewIntent: vi.fn<() => ReturnType<typeof owner.beginOrdinary>>(),
        destination: {},
        buffer: {},
        source,
    };
});

vi.mock('../scheduling/createBufferSource', () => ({
    createBufferSource: mocks.createBufferSource,
}));

vi.mock('../engineAccess/getAudioContext', () => ({
    audioEngine: { beginAudioPreviewIntent: mocks.beginAudioPreviewIntent },
    getAudioContext: vi.fn(() => ({
        destination: mocks.destination,
    })),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: mocks.audioBufferCacheGet,
    },
}));

function admittedIntent(): ReturnType<typeof owner.beginOrdinary> {
    const admission = mocks.beginAudioPreviewIntent.mock.results.at(-1);
    if (admission?.type !== 'return') {
        throw new Error('The preview must have acquired its own intent.');
    }
    return admission.value;
}

describe('playCachedAudioBufferPreview', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        owner = createAudioPreviewIntents();
        mocks.beginAudioPreviewIntent.mockImplementation(() => owner.beginOrdinary());
        mocks.source = {
            buffer: null,
            connect: mocks.connect,
            disconnect: mocks.disconnect,
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
        expect(mocks.source.onended).toBeTypeOf('function');
        expect(mocks.start).toHaveBeenCalledTimes(1);
        result?.stop();
        expect(mocks.stop).toHaveBeenCalledTimes(1);
    });
    it('stops and disconnects a sounding cached preview when an exclusive intent preempts it', () => {
        mocks.audioBufferCacheGet.mockReturnValue(mocks.buffer);
        const onEnded = vi.fn();
        playCachedAudioBufferPreview({ bufferId: 'preview', onEnded });
        const exclusive = owner.beginExclusive();
        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(mocks.disconnect).toHaveBeenCalledTimes(1);
        expect(onEnded).toHaveBeenCalledTimes(1);
        expect(exclusive.isCurrent()).toBe(true);
    });

    it('releases once on stop, even when the old ended callback arrives later', () => {
        mocks.audioBufferCacheGet.mockReturnValue(mocks.buffer);
        const onEnded = vi.fn();
        const playback = playCachedAudioBufferPreview({ bufferId: 'preview', onEnded });
        const ended = mocks.source.onended;
        if (playback === null || ended === null) {
            throw new Error('A cached preview must have a playback and an ended callback.');
        }
        playback.stop();
        playback.stop();
        ended();
        expect(admittedIntent().isCurrent()).toBe(false);
        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(mocks.disconnect).toHaveBeenCalledTimes(1);
        expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it('disconnects natural completion without stopping an already-ended source', () => {
        mocks.audioBufferCacheGet.mockReturnValue(mocks.buffer);
        const onEnded = vi.fn();
        const playback = playCachedAudioBufferPreview({ bufferId: 'preview', onEnded });
        const ended = mocks.source.onended;
        if (playback === null || ended === null) {
            throw new Error('A cached preview must have a playback and an ended callback.');
        }
        ended();
        playback.stop();
        ended();
        expect(admittedIntent().isCurrent()).toBe(false);
        expect(mocks.stop).not.toHaveBeenCalled();
        expect(mocks.disconnect).toHaveBeenCalledTimes(1);
        expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it('still disconnects and releases when stopping reports a failure', () => {
        mocks.audioBufferCacheGet.mockReturnValue(mocks.buffer);
        const failure = new Error('source stop failed');
        const onEnded = vi.fn();
        const playback = playCachedAudioBufferPreview({ bufferId: 'preview', onEnded });
        if (playback === null) {
            throw new Error('The cached preview must start.');
        }
        mocks.stop.mockImplementationOnce(() => {
            throw failure;
        });
        expect(() => playback.stop()).toThrow(failure);
        expect(mocks.disconnect).toHaveBeenCalledTimes(1);
        expect(onEnded).toHaveBeenCalledTimes(1);
        owner.beginExclusive();
        expect(mocks.stop).toHaveBeenCalledTimes(1);
    });

    it('releases a failed start without reporting that it played or retaining an abort listener', () => {
        mocks.audioBufferCacheGet.mockReturnValue(mocks.buffer);
        const failure = new Error('source start failed');
        const onEnded = vi.fn();
        mocks.start.mockImplementationOnce(() => {
            throw failure;
        });
        expect(() => playCachedAudioBufferPreview({ bufferId: 'preview', onEnded })).toThrow(failure);
        expect(mocks.disconnect).toHaveBeenCalledTimes(1);
        expect(onEnded).not.toHaveBeenCalled();
        owner.beginExclusive();
        expect(mocks.stop).not.toHaveBeenCalled();
        expect(onEnded).not.toHaveBeenCalled();
    });

    it('does not construct sound when a newer gesture preempts admission reentrantly', () => {
        mocks.audioBufferCacheGet.mockReturnValue(mocks.buffer);
        const previous = owner.beginExclusive();
        previous.signal.addEventListener('abort', () => {
            owner.beginExclusive();
        });
        expect(playCachedAudioBufferPreview({ bufferId: 'preview', onEnded: vi.fn() })).toBeNull();
        expect(mocks.createBufferSource).not.toHaveBeenCalled();
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it('does not preempt an exclusive audition when the requested buffer is missing', () => {
        mocks.audioBufferCacheGet.mockReturnValue(undefined);
        const exclusive = owner.beginExclusive();
        expect(playCachedAudioBufferPreview({ bufferId: 'missing', onEnded: vi.fn() })).toBeNull();
        expect(exclusive.isCurrent()).toBe(true);
        expect(mocks.beginAudioPreviewIntent).not.toHaveBeenCalled();
    });
    it('releases admission when creating the source fails', () => {
        mocks.audioBufferCacheGet.mockReturnValue(mocks.buffer);
        const failure = new Error('source creation failed');
        const onEnded = vi.fn();
        mocks.createBufferSource.mockImplementationOnce(() => {
            throw failure;
        });
        expect(() => playCachedAudioBufferPreview({ bufferId: 'preview', onEnded })).toThrow(failure);
        expect(admittedIntent().isCurrent()).toBe(false);
        expect(onEnded).not.toHaveBeenCalled();
    });

    it('rechecks ownership after connecting and before starting the source', () => {
        mocks.audioBufferCacheGet.mockReturnValue(mocks.buffer);
        mocks.connect.mockImplementationOnce(() => {
            owner.beginExclusive();
        });
        const onEnded = vi.fn();
        expect(playCachedAudioBufferPreview({ bufferId: 'preview', onEnded })).toBeNull();
        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.stop).not.toHaveBeenCalled();
        expect(mocks.disconnect).toHaveBeenCalledTimes(1);
        expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it('retains every cleanup failure while still releasing ownership and notifying the caller', () => {
        mocks.audioBufferCacheGet.mockReturnValue(mocks.buffer);
        const stopFailure = new Error('source stop failed');
        const disconnectFailure = new Error('source disconnect failed');
        const onEnded = vi.fn();
        const playback = playCachedAudioBufferPreview({ bufferId: 'preview', onEnded });
        if (playback === null) {
            throw new Error('The cached preview must start.');
        }
        mocks.stop.mockImplementationOnce(() => {
            throw stopFailure;
        });
        mocks.disconnect.mockImplementationOnce(() => {
            throw disconnectFailure;
        });
        let thrown: unknown;
        try {
            playback.stop();
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(AggregateError);
        expect(thrown).toMatchObject({ errors: [stopFailure, disconnectFailure] });
        expect(onEnded).toHaveBeenCalledTimes(1);
        owner.beginExclusive();
        expect(mocks.stop).toHaveBeenCalledTimes(1);
    });
});
