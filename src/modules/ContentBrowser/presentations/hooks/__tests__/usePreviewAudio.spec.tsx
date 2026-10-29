import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { createAudioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import { type AudioEngine } from '#/modules/AudioEngine/models/AudioEngineState';

const fixture = vi.hoisted(() => ({ engine: null as AudioEngine | null }));
vi.mock('#/modules/AudioEngine/repositories/createWebAudioEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/repositories/createWebAudioEngine')>();
    return {
        ...actual,
        get audioEngine() {
            if (fixture.engine === null) throw new Error('The browser preview fixture engine is not installed.');
            return fixture.engine;
        },
    };
});

import { usePreviewAudio } from '../usePreviewAudio';

function makeMockContext() {
    const gain = {
        gain: {
            value: 1,
            setValueAtTime: vi.fn(),
            cancelScheduledValues: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
    };
    const sources: Array<{
        buffer: AudioBuffer | null;
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        onended: (() => void) | null;
    }> = [];
    const makeSource = () => {
        const s = {
            buffer: null as AudioBuffer | null,
            connect: vi.fn(),
            disconnect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            onended: null as (() => void) | null,
        };
        sources.push(s);
        return s;
    };
    const source = makeSource();
    let firstCall = true;
    const createBufferSource = vi.fn(() => {
        if (firstCall) {
            firstCall = false;
            return source;
        }
        return makeSource();
    });
    const oscillator = {
        frequency: { value: 440 },
        type: 'sine',
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
    };
    const silentNode = () => ({ connect: vi.fn(), disconnect: vi.fn(), fftSize: 256, smoothingTimeConstant: 0.8 });
    const ctx = {
        state: 'running',
        sampleRate: 48_000,
        createAnalyser: silentNode,
        createChannelSplitter: silentNode,
        currentTime: 0,
        resume: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        destination: {},
        createBufferSource,
        createOscillator: vi.fn(() => oscillator),
        createGain: vi.fn(() => gain),
        decodeAudioData: vi.fn(() => Promise.resolve({} as AudioBuffer)),
    };
    fixture.engine = createAudioEngine(ctx as unknown as AudioContext);
    return { ctx, gain, source, sources, oscillator };
}

describe('usePreviewAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await act(async () => {
            cleanup();
            await fixture.engine?.dispose();
        });
        fixture.engine = null;
        vi.restoreAllMocks();
    });

    it('returns a PreviewHandle with playingId null initially', () => {
        makeMockContext();
        const { result } = renderHook(() => usePreviewAudio());
        expect(result.current.playingId).toBeNull();
        expect(typeof result.current.play).toBe('function');
        expect(typeof result.current.stop).toBe('function');
        expect(typeof result.current.playTone).toBe('function');
    });

    it('sets playingId when playing a buffer', () => {
        const { ctx, source } = makeMockContext();
        const { result } = renderHook(() => usePreviewAudio());
        const buffer = { duration: 1 } as AudioBuffer;
        act(() => {
            result.current.play('sample-1', buffer);
        });
        expect(result.current.playingId).toBe('sample-1');
        expect(source.buffer).toBe(buffer);
    });

    it('clears playingId on stop', () => {
        const { ctx } = makeMockContext();
        const { result } = renderHook(() => usePreviewAudio());
        act(() => {
            result.current.play('sample-1', {} as AudioBuffer);
        });
        expect(result.current.playingId).toBe('sample-1');
        act(() => {
            result.current.stop();
        });
        expect(result.current.playingId).toBeNull();
    });

    it('resumes the context if it is suspended', () => {
        const { ctx } = makeMockContext();
        ctx.state = 'suspended';
        const { result } = renderHook(() => usePreviewAudio());
        act(() => {
            result.current.play('sample-1', {} as AudioBuffer);
        });
        expect(ctx.resume).toHaveBeenCalled();
    });

    it('plays a tone via oscillator', () => {
        const { ctx, oscillator } = makeMockContext();
        const { result } = renderHook(() => usePreviewAudio());
        act(() => {
            result.current.playTone('tone-1', 440, 0.5);
        });
        expect(result.current.playingId).toBe('tone-1');
        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(oscillator.frequency.value).toBe(440);
        expect(oscillator.start).toHaveBeenCalled();
    });

    it('stops the previous source when playing a new one', () => {
        const { ctx, source } = makeMockContext();
        const { result } = renderHook(() => usePreviewAudio());
        act(() => {
            result.current.play('sample-1', {} as AudioBuffer);
        });
        const firstSource = source;
        act(() => {
            result.current.play('sample-2', {} as AudioBuffer);
        });
        expect(firstSource.stop).toHaveBeenCalled();
        expect(firstSource.disconnect).toHaveBeenCalled();
    });

    it('does not start audio source if stop() is called while decode is in-flight', async () => {
        const { ctx, source } = makeMockContext();
        let resolveDecode!: (buffer: AudioBuffer) => void;
        ctx.decodeAudioData = vi.fn(
            () =>
                new Promise<AudioBuffer>((resolve) => {
                    resolveDecode = resolve;
                })
        );

        const { result } = renderHook(() => usePreviewAudio());
        const fakeFile = {
            arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
        } as unknown as File;

        const playPromise = result.current.playFile('sample1', fakeFile);
        await waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1));

        // Call stop while decode is pending
        act(() => {
            result.current.stop();
        });

        // Resolve decode
        await act(async () => {
            resolveDecode({} as AudioBuffer);
            await playPromise;
        });

        // Verify source was not started and playingId is null
        expect(result.current.playingId).toBeNull();
        expect(source.start).not.toHaveBeenCalled();
        expect(ctx.createBufferSource).not.toHaveBeenCalled();
    });

    it('does not start audio source if unmounted while decode is in-flight', async () => {
        const { ctx, source } = makeMockContext();
        let resolveDecode!: (buffer: AudioBuffer) => void;
        ctx.decodeAudioData = vi.fn(
            () =>
                new Promise<AudioBuffer>((resolve) => {
                    resolveDecode = resolve;
                })
        );

        const { result, unmount } = renderHook(() => usePreviewAudio());
        const fakeFile = {
            arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
        } as unknown as File;

        const playPromise = result.current.playFile('sample1', fakeFile);
        await waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1));

        // Unmount while decode is pending
        unmount();

        // Resolve decode
        await act(async () => {
            resolveDecode({} as AudioBuffer);
            await playPromise;
        });

        expect(source.start).not.toHaveBeenCalled();
        expect(ctx.createBufferSource).not.toHaveBeenCalled();
    });

    it('plays only the latest audition under reversed decode completion order', async () => {
        const { ctx, source } = makeMockContext();
        let resolveDecode1!: (buffer: AudioBuffer) => void;
        let resolveDecode2!: (buffer: AudioBuffer) => void;

        ctx.decodeAudioData = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<AudioBuffer>((resolve) => {
                        resolveDecode1 = resolve;
                    })
            )
            .mockImplementationOnce(
                () =>
                    new Promise<AudioBuffer>((resolve) => {
                        resolveDecode2 = resolve;
                    })
            );

        const { result } = renderHook(() => usePreviewAudio());
        const fakeFile1 = {
            arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
        } as unknown as File;
        const fakeFile2 = {
            arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
        } as unknown as File;

        const playPromise1 = result.current.playFile('s1', fakeFile1);
        await waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1));

        const playPromise2 = result.current.playFile('s2', fakeFile2);
        await waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledTimes(2));

        // Resolve decode 2 first
        const buffer2 = { id: 'buf2' } as unknown as AudioBuffer;
        await act(async () => {
            resolveDecode2(buffer2);
            await playPromise2;
        });

        expect(result.current.playingId).toBe('s2');
        expect(source.start).toHaveBeenCalledTimes(1);
        expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);

        // Resolve decode 1 second
        const buffer1 = { id: 'buf1' } as unknown as AudioBuffer;
        await act(async () => {
            resolveDecode1(buffer1);
            await playPromise1;
        });

        // Must still be s2, decode 1 did not start a new source or change playingId
        expect(result.current.playingId).toBe('s2');
        expect(source.start).toHaveBeenCalledTimes(1);
        expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    });
    it('an older decoded file cannot acquire sound over a newer exclusive gesture', async () => {
        const { ctx } = makeMockContext();
        const decode = Promise.withResolvers<AudioBuffer>();
        ctx.decodeAudioData.mockReturnValueOnce(decode.promise);
        const { result } = renderHook(() => usePreviewAudio());
        const file = { arrayBuffer: async () => new ArrayBuffer(8) } as unknown as File;
        const pending = result.current.playFile('old-file', file);
        await waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1));
        let exclusive: ReturnType<AudioEngine['beginExclusiveAudioPreviewIntent']> | undefined;
        act(() => {
            exclusive = fixture.engine?.beginExclusiveAudioPreviewIntent();
        });
        await act(async () => {
            decode.resolve({} as AudioBuffer);
            await pending;
        });
        expect(exclusive?.isCurrent()).toBe(true);
        expect(ctx.createBufferSource).not.toHaveBeenCalled();
        expect(result.current.playingId).toBeNull();
    });

    it('natural tone completion clears the playing identity without a second source stop', () => {
        const { oscillator } = makeMockContext();
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.playTone('tone', 440, 0.5));
        expect(oscillator.stop).toHaveBeenCalledTimes(1);
        act(() => oscillator.onended?.());
        expect(result.current.playingId).toBeNull();
        expect(oscillator.stop).toHaveBeenCalledTimes(1);
    });
});
