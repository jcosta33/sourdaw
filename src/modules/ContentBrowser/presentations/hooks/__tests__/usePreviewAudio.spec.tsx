import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import * as engineApi from '#/modules/AudioEngine/useCases';

import { usePreviewAudio } from '../usePreviewAudio';

const preset = vi.hoisted(() => ({
    render: vi.fn<(typeof import('../../../useCases/renderPresetPreview'))['renderPresetPreview']>(),
    notify: vi.fn(),
}));
vi.mock('../../../useCases/renderPresetPreview', () => ({ renderPresetPreview: preset.render }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: preset.notify }));

const webAudio = vi.hoisted(() => {
    type Source = {
        buffer: AudioBuffer | null;
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        onended: (() => void) | null;
    };
    function buffer(): AudioBuffer {
        const samples = new Float32Array(48_000).fill(0.1);
        return {
            sampleRate: 48_000,
            length: samples.length,
            duration: 1,
            numberOfChannels: 1,
            getChannelData: () => samples,
            copyFromChannel: (destination, _channel, offset = 0) =>
                destination.set(samples.subarray(offset, offset + destination.length)),
            copyToChannel: (source, _channel, offset = 0) => samples.set(source, offset),
        };
    }
    function nodes() {
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
        const sources: Source[] = [];
        const makeSource = () => {
            const source: Source = {
                buffer: null,
                connect: vi.fn(),
                disconnect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
                onended: null,
            };
            sources.push(source);
            return source;
        };
        const source = makeSource();
        const oscillator: {
            frequency: { value: number };
            type: string;
            connect: ReturnType<typeof vi.fn>;
            disconnect: ReturnType<typeof vi.fn>;
            start: ReturnType<typeof vi.fn>;
            stop: ReturnType<typeof vi.fn>;
            onended: (() => void) | null;
        } = {
            frequency: { value: 440 },
            type: 'sine',
            connect: vi.fn(),
            disconnect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            onended: null,
        };
        const createBufferSource = vi.fn(() => makeSource()).mockImplementationOnce(() => source);
        return { gain, sources, source, oscillator, createBufferSource };
    }
    let current = nodes();
    const silentNode = () => ({ connect: vi.fn(), disconnect: vi.fn(), fftSize: 256, smoothingTimeConstant: 0.8 });
    const ctx = {
        state: 'running',
        sampleRate: 48_000,
        currentTime: 0,
        destination: {},
        createAnalyser: silentNode,
        createChannelSplitter: silentNode,
        resume: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        createBufferSource: current.createBufferSource,
        createOscillator: vi.fn(() => current.oscillator),
        createGain: vi.fn(() => current.gain),
        decodeAudioData: vi.fn<(bytes: ArrayBuffer) => Promise<AudioBuffer>>().mockImplementation(async () => buffer()),
    };
    let constructions = 0;
    vi.stubGlobal(
        'AudioContext',
        vi.fn(function () {
            constructions++;
            return ctx;
        })
    );
    return {
        ctx,
        buffer,
        constructions: () => constructions,
        freshNodes: () => {
            current = nodes();
            ctx.state = 'running';
            ctx.currentTime = 0;
            ctx.resume = vi.fn().mockResolvedValue(undefined);
            ctx.close = vi.fn().mockResolvedValue(undefined);
            ctx.decodeAudioData = vi
                .fn<(bytes: ArrayBuffer) => Promise<AudioBuffer>>()
                .mockImplementation(async () => buffer());
            ctx.createBufferSource = current.createBufferSource;
            ctx.createOscillator = vi.fn(() => current.oscillator);
            ctx.createGain = vi.fn(() => current.gain);
            return { ctx, ...current };
        },
    };
});

function previewBuffer(): AudioBuffer {
    return webAudio.buffer();
}

type Engine = typeof engineApi.audioEngine;
const fixture: { engine: Engine | null } = { engine: engineApi.audioEngine };
let mockContext: ReturnType<typeof webAudio.freshNodes>;

describe('usePreviewAudio', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        // Retire the actual ordinary/exclusive lifetime before fresh node evidence is installed.
        engineApi.audioEngine.resetGraph();
        engineApi.audioEngine.setAudioPreviewProgrammeSuppressed(false);
        vi.clearAllMocks();
        preset.render.mockReset();
        mockContext = webAudio.freshNodes();
        expect(engineApi.audioEngine.context).toBe(webAudio.ctx);
        expect(webAudio.constructions()).toBe(1);
    });

    afterEach(() => {
        act(() => cleanup());
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        await act(async () => {
            await engineApi.audioEngine.dispose();
        });
        expect(webAudio.ctx.close).toHaveBeenCalledTimes(1);
        fixture.engine = null;
        vi.unstubAllGlobals();
    });

    it('retires stale exclusive ownership through real resetGraph while retaining the same context', () => {
        const engine = engineApi.audioEngine;
        const exclusive = engine.beginExclusiveAudioPreviewIntent();
        expect(exclusive.isCurrent()).toBe(true);
        engine.resetGraph();
        engine.setAudioPreviewProgrammeSuppressed(false);
        expect(exclusive.signal.aborted).toBe(true);
        expect(exclusive.isCurrent()).toBe(false);
        expect(engine.context).toBe(webAudio.ctx);
        expect(webAudio.constructions()).toBe(1);
        const fresh = engine.beginAudioPreviewIntent();
        expect(fresh.isCurrent()).toBe(true);
        expect(fresh.ready).toBeUndefined();
        fresh.release();
    });

    it('returns a PreviewHandle with playingId null initially', async () => {
        const { result } = renderHook(() => usePreviewAudio());
        expect(result.current.playingId).toBeNull();
        expect(typeof result.current.play).toBe('function');
        expect(typeof result.current.stop).toBe('function');
        expect(typeof result.current.playTone).toBe('function');
    });

    it('sets playingId when playing a buffer', async () => {
        const { source } = mockContext;
        const { result } = renderHook(() => usePreviewAudio());
        const buffer = { duration: 1 } as AudioBuffer;
        act(() => {
            result.current.play('sample-1', buffer);
        });
        expect(result.current.playingId).toBe('sample-1');
        expect(source.buffer).toBe(buffer);
    });

    it('clears playingId on stop', async () => {
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

    it('resumes the context if it is suspended', async () => {
        const { ctx } = mockContext;
        ctx.state = 'suspended';
        const { result } = renderHook(() => usePreviewAudio());
        act(() => {
            result.current.play('sample-1', {} as AudioBuffer);
        });
        expect(ctx.resume).toHaveBeenCalled();
    });

    it('plays a tone via oscillator', async () => {
        const { ctx, oscillator } = mockContext;
        const { result } = renderHook(() => usePreviewAudio());
        act(() => {
            result.current.playTone('tone-1', 440, 0.5);
        });
        expect(result.current.playingId).toBe('tone-1');
        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(oscillator.frequency.value).toBe(440);
        expect(oscillator.start).toHaveBeenCalled();
    });

    it('stops the previous source when playing a new one', async () => {
        const { source } = mockContext;
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
        const { ctx, source } = mockContext;
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
        const { ctx, source } = mockContext;
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
        const { ctx, source } = mockContext;
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
        const { ctx } = mockContext;
        const decode = Promise.withResolvers<AudioBuffer>();
        ctx.decodeAudioData.mockReturnValueOnce(decode.promise);
        const { result } = renderHook(() => usePreviewAudio());
        const file = { arrayBuffer: async () => new ArrayBuffer(8) } as unknown as File;
        const pending = result.current.playFile('old-file', file);
        await waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1));
        let exclusive: ReturnType<Engine['beginExclusiveAudioPreviewIntent']> | undefined;
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

    it('natural tone completion clears the playing identity without a second source stop', async () => {
        const { oscillator } = mockContext;
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.playTone('tone', 440, 0.5));
        expect(oscillator.stop).toHaveBeenCalledTimes(1);
        act(() => oscillator.onended?.());
        expect(result.current.playingId).toBeNull();
        expect(oscillator.stop).toHaveBeenCalledTimes(1);
    });

    it('exposes Stop while a preset is preparing and cannot start or notify after Stop', async () => {
        const { ctx } = mockContext;
        const held = Promise.withResolvers<Awaited<ReturnType<typeof preset.render>>>();
        preset.render.mockReturnValueOnce(held.promise);
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.play('acid', { kind: 'preset', presetId: 'factory-bass-acid' }));
        expect(result.current.playingId).toBe('acid');
        await waitFor(() => expect(preset.render).toHaveBeenCalledTimes(1));
        expect(preset.render.mock.calls[0]?.[0]).toMatchObject({ presetId: 'factory-bass-acid', sampleRate: 48_000 });
        act(() => result.current.stop());
        expect(preset.render.mock.calls[0]?.[0].signal.aborted).toBe(true);
        await act(async () => {
            held.resolve({ buffer: previewBuffer(), isCurrent: () => true });
            await held.promise;
        });
        expect(result.current.playingId).toBeNull();
        expect(ctx.createBufferSource).not.toHaveBeenCalled();
        expect(preset.notify).not.toHaveBeenCalled();
    });

    it('keeps only the newer preset under reversed preparation completion', async () => {
        const { ctx, source } = mockContext;
        const a = Promise.withResolvers<Awaited<ReturnType<typeof preset.render>>>();
        const b = Promise.withResolvers<Awaited<ReturnType<typeof preset.render>>>();
        preset.render.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
        await waitFor(() => expect(preset.render).toHaveBeenCalledTimes(1));
        act(() => result.current.play('b', { kind: 'preset', presetId: 'b' }));
        await waitFor(() => expect(preset.render).toHaveBeenCalledTimes(2));
        const latest = previewBuffer();
        await act(async () => {
            b.resolve({ buffer: latest, isCurrent: () => true });
            await b.promise;
        });
        expect(source.buffer).toBe(latest);
        expect(source.start).toHaveBeenCalledTimes(1);
        await act(async () => {
            a.resolve({ buffer: previewBuffer(), isCurrent: () => true });
            await a.promise;
        });
        expect(result.current.playingId).toBe('b');
        expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
        expect(preset.notify).not.toHaveBeenCalled();
    });

    it('does not finish preset preparation after unmount', async () => {
        const { ctx } = mockContext;
        const held = Promise.withResolvers<Awaited<ReturnType<typeof preset.render>>>();
        preset.render.mockReturnValueOnce(held.promise);
        const { result, unmount } = renderHook(() => usePreviewAudio());
        act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
        await waitFor(() => expect(preset.render).toHaveBeenCalledTimes(1));
        unmount();
        await act(async () => {
            held.resolve({ buffer: previewBuffer(), isCurrent: () => true });
            await held.promise;
        });
        expect(preset.render.mock.calls[0]?.[0].signal.aborted).toBe(true);
        expect(ctx.createBufferSource).not.toHaveBeenCalled();
        expect(preset.notify).not.toHaveBeenCalled();
    });

    it('captures original ownership before context resume and retires before rendering when stopped', async () => {
        const { ctx } = mockContext;
        ctx.state = 'suspended';
        const resumed = Promise.withResolvers<void>();
        ctx.resume.mockReturnValueOnce(resumed.promise);
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
        expect(result.current.playingId).toBe('a');
        expect(ctx.resume).toHaveBeenCalledTimes(1);
        act(() => result.current.stop());
        await act(async () => {
            resumed.resolve();
            await resumed.promise;
        });
        expect(preset.render).not.toHaveBeenCalled();
        expect(ctx.createBufferSource).not.toHaveBeenCalled();
    });

    it('visibly reports a current failure and remains silent for a stale rejected render', async () => {
        const error = new Error('Unsupported chain');
        preset.render.mockRejectedValueOnce(error);
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
        await waitFor(() =>
            expect(preset.notify).toHaveBeenCalledWith('Could not preview this preset. Try another sound.', 'error')
        );
        expect(result.current.playingId).toBeNull();
        preset.notify.mockClear();
        const held = Promise.withResolvers<Awaited<ReturnType<typeof preset.render>>>();
        preset.render.mockReturnValueOnce(held.promise);
        act(() => result.current.play('b', { kind: 'preset', presetId: 'b' }));
        await waitFor(() => expect(preset.render).toHaveBeenCalledTimes(2));
        act(() => result.current.stop());
        await act(async () => {
            held.reject(error);
            await held.promise.catch(() => undefined);
        });
        expect(preset.notify).not.toHaveBeenCalled();
        expect(result.current.playingId).toBeNull();
    });

    it('silently clears a retired prepared contract before calling playback', async () => {
        const { ctx } = mockContext;
        preset.render.mockResolvedValueOnce({ buffer: previewBuffer(), isCurrent: () => false });
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
        await waitFor(() => expect(result.current.playingId).toBeNull());
        expect(preset.render).toHaveBeenCalledTimes(1);
        expect(ctx.createBufferSource).not.toHaveBeenCalled();
        expect(preset.notify).not.toHaveBeenCalled();
    });

    it('retains the original gesture authority and rechecks contract after actual held playback readiness', async () => {
        const { source } = mockContext;
        const engine = fixture.engine;
        if (!engine) {
            throw new Error('Missing engine fixture');
        }
        const ready = Promise.withResolvers<void>();
        const beginOriginal = engine.beginAudioPreviewIntent.bind(engine);
        let original: ReturnType<Engine['beginAudioPreviewIntent']> | undefined;
        const begin = vi.spyOn(engine, 'beginAudioPreviewIntent').mockImplementation(() => {
            const intent = beginOriginal();
            original = { ...intent, ready: ready.promise, release: vi.fn(intent.release) };
            return original;
        });
        const playback = vi.spyOn(engineApi, 'playAudioBufferPreview');
        let currentContract = true;
        preset.render.mockResolvedValueOnce({ buffer: previewBuffer(), isCurrent: () => currentContract });
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
        await waitFor(() => expect(playback).toHaveBeenCalledTimes(1));
        const capability = playback.mock.calls[0]?.[0].intent;
        if (!original || !capability) {
            throw new Error('Missing admitted gesture');
        }
        expect(capability.signal).toBe(original.signal);
        expect(capability.ready).toBe(original.ready);
        expect(typeof capability.release).toBe('function');
        expect(capability.isCurrent()).toBe(true);
        expect(source.start).not.toHaveBeenCalled();
        currentContract = false;
        const activePlayback: ReturnType<typeof playback> = playback.mock.results[0]?.value;
        if (!activePlayback) {
            throw new Error('Missing actual ready continuation');
        }
        await act(async () => {
            ready.resolve();
            await expect(activePlayback.ready).rejects.toThrow('superseded before playback');
        });
        expect(original.signal.aborted).toBe(true);
        expect(original.release).toHaveBeenCalledTimes(1);
        expect(source.start).not.toHaveBeenCalled();
        expect(result.current.playingId).toBeNull();
        expect(preset.notify).not.toHaveBeenCalled();
        expect(begin).toHaveBeenCalledTimes(1);
    });

    it('visibly reports a genuine held output-restoration rejection through the real playback owner', async () => {
        const warn = vi.spyOn(logger, 'warn');
        const { source } = mockContext;
        const engine = fixture.engine;
        if (!engine) {
            throw new Error('Missing engine fixture');
        }
        const ready = Promise.withResolvers<void>();
        const beginOriginal = engine.beginAudioPreviewIntent.bind(engine);
        vi.spyOn(engine, 'beginAudioPreviewIntent').mockImplementation(() => ({
            ...beginOriginal(),
            ready: ready.promise,
        }));
        const playback = vi.spyOn(engineApi, 'playAudioBufferPreview');
        preset.render.mockResolvedValueOnce({ buffer: previewBuffer(), isCurrent: () => true });
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
        await waitFor(() => expect(playback).toHaveBeenCalledTimes(1));
        const active: ReturnType<typeof playback> = playback.mock.results[0]?.value;
        if (!active) {
            throw new Error('Missing real playback owner');
        }
        const error = new Error('Listening output restoration failed');
        await act(async () => {
            ready.reject(error);
            await expect(active.ready).rejects.toBe(error);
        });
        expect(source.start).not.toHaveBeenCalled();
        expect(result.current.playingId).toBeNull();
        expect(preset.notify).toHaveBeenCalledWith('Could not preview this preset. Try another sound.', 'error');
        expect(preset.notify).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Browser audio preview failed', cause: error })
        );
    });

    it('visibly reports a genuine source start failure through the real playback owner', async () => {
        const warn = vi.spyOn(logger, 'warn');
        const { source } = mockContext;
        const error = new Error('Live source start failed');
        source.start.mockImplementationOnce(() => {
            throw error;
        });
        preset.render.mockResolvedValueOnce({ buffer: previewBuffer(), isCurrent: () => true });
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
        await waitFor(() => expect(source.start).toHaveBeenCalledTimes(1));
        expect(result.current.playingId).toBeNull();
        expect(preset.notify).toHaveBeenCalledWith('Could not preview this preset. Try another sound.', 'error');
        expect(preset.notify).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Browser audio preview failed', cause: error })
        );
    });

    it.each(['stop', 'new', 'unmount', 'external'] as const)(
        'keeps held-ready %s withdrawal silent through actual playback settlement',
        async (withdrawal) => {
            const { ctx, source } = mockContext;
            const engine = fixture.engine;
            if (!engine) {
                throw new Error('Missing engine fixture');
            }
            const ready = Promise.withResolvers<void>();
            const beginOriginal = engine.beginAudioPreviewIntent.bind(engine);
            vi.spyOn(engine, 'beginAudioPreviewIntent').mockImplementationOnce(() => ({
                ...beginOriginal(),
                ready: ready.promise,
            }));
            const playback = vi.spyOn(engineApi, 'playAudioBufferPreview');
            preset.render.mockResolvedValueOnce({ buffer: previewBuffer(), isCurrent: () => true });
            const { result, unmount } = renderHook(() => usePreviewAudio());
            act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
            await waitFor(() => expect(playback).toHaveBeenCalledTimes(1));
            const active: ReturnType<typeof playback> = playback.mock.results[0]?.value;
            if (!active) {
                throw new Error('Missing actual playback');
            }
            act(() => {
                switch (withdrawal) {
                    case 'stop':
                        result.current.stop();
                        break;
                    case 'new':
                        result.current.play('b', previewBuffer());
                        break;
                    case 'unmount':
                        unmount();
                        break;
                    case 'external':
                        engine.beginExclusiveAudioPreviewIntent();
                        break;
                }
            });
            await act(async () => {
                ready.resolve();
                await expect(active.ready).rejects.toThrow('superseded before playback');
            });
            expect(source.start).not.toHaveBeenCalled();
            expect(preset.notify).not.toHaveBeenCalled();
            if (withdrawal === 'new') {
                expect(result.current.playingId).toBe('b');
                expect(ctx.createBufferSource).toHaveBeenCalledTimes(2);
            } else if (withdrawal !== 'unmount') {
                expect(result.current.playingId).toBeNull();
            }
        }
    );

    it('a newer preview invalidates an older cleanup witness before its actual error settles', async () => {
        const { sources, source } = mockContext;
        const engine = fixture.engine;
        if (!engine) {
            throw new Error('Missing engine fixture');
        }
        const ready = Promise.withResolvers<void>();
        const beginOriginal = engine.beginAudioPreviewIntent.bind(engine);
        let original: ReturnType<Engine['beginAudioPreviewIntent']> | undefined;
        vi.spyOn(engine, 'beginAudioPreviewIntent').mockImplementationOnce(() => {
            original = { ...beginOriginal(), ready: ready.promise };
            return original;
        });
        const playback = vi.spyOn(engineApi, 'playAudioBufferPreview');
        preset.render.mockResolvedValueOnce({ buffer: previewBuffer(), isCurrent: () => true });
        const { result } = renderHook(() => usePreviewAudio());
        act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
        await waitFor(() => expect(playback).toHaveBeenCalledTimes(1));
        const active: ReturnType<typeof playback> = playback.mock.results[0]?.value;
        if (!active || !original) {
            throw new Error('Missing original actual playback');
        }
        original.signal.addEventListener('abort', () => result.current.play('b', previewBuffer()), { once: true });
        const error = new Error('Old source failed');
        source.start.mockImplementationOnce(() => {
            throw error;
        });
        await act(async () => {
            ready.resolve();
            await expect(active.ready).rejects.toBe(error);
        });
        expect(source.start).toHaveBeenCalledTimes(1);
        expect(sources[1]?.start).toHaveBeenCalledTimes(1);
        expect(result.current.playingId).toBe('b');
        expect(preset.notify).not.toHaveBeenCalled();
    });

    it.each(['retired', 'valid'] as const)(
        'defers early ready rejection attribution until %s authoritative preparation settles',
        async (outcome) => {
            const warn = vi.spyOn(logger, 'warn');
            const engine = engineApi.audioEngine;
            const ready = Promise.withResolvers<void>();
            const held = Promise.withResolvers<Awaited<ReturnType<typeof preset.render>>>();
            const beginOriginal = engine.beginAudioPreviewIntent.bind(engine);
            vi.spyOn(engine, 'beginAudioPreviewIntent').mockImplementationOnce(() => ({
                ...beginOriginal(),
                ready: ready.promise,
            }));
            const playback = vi.spyOn(engineApi, 'playAudioBufferPreview');
            preset.render.mockReturnValueOnce(held.promise);
            const { result } = renderHook(() => usePreviewAudio());
            act(() => result.current.play('a', { kind: 'preset', presetId: 'a' }));
            await waitFor(() => expect(preset.render).toHaveBeenCalledTimes(1));
            const error = new Error('Listening output failed before preparation settled');
            await act(async () => {
                ready.reject(error);
                await ready.promise.catch(() => undefined);
            });
            const earlyNotifications = preset.notify.mock.calls.length;
            const earlyWarnings = warn.mock.calls.length;
            await act(async () => {
                held.resolve(outcome === 'valid' ? { buffer: previewBuffer(), isCurrent: () => true } : null);
                await held.promise;
            });
            expect(earlyNotifications).toBe(0);
            expect(earlyWarnings).toBe(0);
            expect(result.current.playingId).toBeNull();
            if (outcome === 'retired') {
                expect(preset.notify).not.toHaveBeenCalled();
                expect(warn).not.toHaveBeenCalled();
                expect(mockContext.ctx.createBufferSource).not.toHaveBeenCalled();
            } else {
                const active: ReturnType<typeof playback> = playback.mock.results[0]?.value;
                if (!active) {
                    throw new Error('Missing actual failed playback');
                }
                await expect(active.ready).rejects.toBe(error);
                expect(preset.notify).toHaveBeenCalledTimes(1);
                expect(warn).toHaveBeenCalledTimes(1);
                expect(warn).toHaveBeenCalledWith(
                    expect.objectContaining({ message: 'Browser audio preview failed', cause: error })
                );
                expect(mockContext.source.start).not.toHaveBeenCalled();
            }
        }
    );
});
