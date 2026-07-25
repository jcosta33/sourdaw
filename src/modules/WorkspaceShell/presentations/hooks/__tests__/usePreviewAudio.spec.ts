import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAudioContext } from '#/modules/AudioEngine/useCases';

import { usePreviewAudio } from '../usePreviewAudio';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: vi.fn(),
}));

type FakeNode = {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    frequency: { value: number };
    type: string;
    onended: (() => void) | null;
    buffer: unknown;
};

type FakeGain = {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    gain: { value: number; setValueAtTime: vi.ReturnMock; exponentialRampToValueAtTime: vi.ReturnMock };
};

type FakeBufferSource = {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
    buffer: unknown;
};

type FakeContext = {
    state: string;
    currentTime: number;
    resume: ReturnType<typeof vi.fn>;
    destination: unknown;
    createGain: ReturnType<typeof vi.fn>;
    createOscillator: ReturnType<typeof vi.fn>;
    createBufferSource: ReturnType<typeof vi.fn>;
    decodeAudioData: ReturnType<typeof vi.fn>;
};

function makeFakeContext(state = 'running'): {
    ctx: FakeContext;
    oscillators: FakeNode[];
    gains: FakeGain[];
    bufferSources: FakeBufferSource[];
} {
    const oscillators: FakeNode[] = [];
    const gains: FakeGain[] = [];
    const bufferSources: FakeBufferSource[] = [];
    const ctx: FakeContext = {
        state,
        currentTime: 10,
        resume: vi.fn(() => Promise.resolve()),
        destination: {},
        createGain: vi.fn(() => {
            const gain: FakeGain = {
                connect: vi.fn(),
                disconnect: vi.fn(),
                gain: {
                    value: 0,
                    setValueAtTime: vi.fn(),
                    exponentialRampToValueAtTime: vi.fn(),
                },
            };
            gains.push(gain);
            return gain;
        }),
        createOscillator: vi.fn(() => {
            const osc: FakeNode = {
                connect: vi.fn(),
                disconnect: vi.fn(),
                stop: vi.fn(),
                start: vi.fn(),
                frequency: { value: 0 },
                type: 'sine',
                onended: null,
                buffer: null,
            };
            oscillators.push(osc);
            return osc;
        }),
        createBufferSource: vi.fn(() => {
            const src: FakeBufferSource = {
                connect: vi.fn(),
                disconnect: vi.fn(),
                stop: vi.fn(),
                start: vi.fn(),
                onended: null,
                buffer: null,
            };
            bufferSources.push(src);
            return src;
        }),
        decodeAudioData: vi.fn(() => Promise.resolve({ decoded: true })),
    };
    return { ctx, oscillators, gains, bufferSources };
}

describe('usePreviewAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('play (buffer source)', () => {
        it('creates a buffer source, sets gain to 0.7, connects the graph, and starts playback', () => {
            const { ctx, bufferSources, gains } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            const fakeBuffer = { duration: 2 } as unknown as AudioBuffer;

            act(() => {
                result.current.play('clip-1', fakeBuffer);
            });

            expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
            expect(bufferSources[0]!.buffer).toBe(fakeBuffer);
            expect(gains[0]!.gain.value).toBe(0.7);
            expect(bufferSources[0]!.connect).toHaveBeenCalledWith(gains[0]);
            expect(gains[0]!.connect).toHaveBeenCalledWith(ctx.destination);
            expect(bufferSources[0]!.start).toHaveBeenCalledTimes(1);
            expect(result.current.playingId).toBe('clip-1');
        });

        it('resumes the context when it is suspended', () => {
            const { ctx } = makeFakeContext('suspended');
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());

            act(() => {
                result.current.play('clip-1', {} as AudioBuffer);
            });

            expect(ctx.resume).toHaveBeenCalledTimes(1);
        });

        it('cleans up the source and clears playingId when the buffer ends naturally', () => {
            const { ctx, bufferSources } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            act(() => {
                result.current.play('clip-1', {} as AudioBuffer);
            });

            const source = bufferSources[0]!;
            act(() => {
                source.onended?.();
            });

            expect(source.disconnect).toHaveBeenCalled();
            expect(result.current.playingId).toBeNull();
        });

        it('does not clear playingId if a different source has since replaced it', () => {
            const { ctx, bufferSources } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            act(() => {
                result.current.play('clip-1', {} as AudioBuffer);
            });
            const firstSource = bufferSources[0]!;

            // Start a second playback — sourceRef now points to the new source.
            act(() => {
                result.current.play('clip-2', {} as AudioBuffer);
            });

            // The first source's onended fires late — must not clear the active id.
            act(() => {
                firstSource.onended?.();
            });

            expect(result.current.playingId).toBe('clip-2');
        });
    });

    describe('playTone (oscillator)', () => {
        it('creates an oscillator, applies the frequency and exponential gain ramp, and starts it', () => {
            const { ctx, oscillators, gains } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());

            act(() => {
                result.current.playTone('preview-tone', 660, 0.5);
            });

            expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
            const osc = oscillators[0]!;
            expect(osc.frequency.value).toBe(660);
            expect(osc.type).toBe('sine');
            expect(osc.connect).toHaveBeenCalledWith(gains[0]);
            // Gain ramps from 0.4 to 0.001 over durationSec.
            expect(gains[0]!.gain.setValueAtTime).toHaveBeenCalledWith(0.4, 10);
            expect(gains[0]!.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.001, 10.5);
            expect(osc.start).toHaveBeenCalledTimes(1);
            // osc.stop is scheduled at currentTime + duration.
            expect(osc.stop).toHaveBeenCalledWith(10.5);
            expect(result.current.playingId).toBe('preview-tone');
        });

        it('cleans up the oscillator and clears playingId when it ends naturally', () => {
            const { ctx, oscillators } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            act(() => {
                result.current.playTone('preview-tone', 440, 1);
            });

            const osc = oscillators[0]!;
            act(() => {
                osc.onended?.();
            });

            expect(osc.disconnect).toHaveBeenCalled();
            expect(result.current.playingId).toBeNull();
        });
    });

    describe('playFile', () => {
        it('decodes the file and plays the resulting buffer', async () => {
            const { ctx } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            const fakeFile = {
                arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
            } as unknown as File;

            await act(async () => {
                await result.current.playFile('file-1', fakeFile);
            });

            expect(fakeFile.arrayBuffer).toHaveBeenCalledTimes(1);
            expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
            expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
            expect(result.current.playingId).toBe('file-1');
        });

        it('resumes a suspended context before decoding (awaited)', async () => {
            const { ctx } = makeFakeContext('suspended');
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            const fakeFile = {
                arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
            } as unknown as File;

            await act(async () => {
                await result.current.playFile('file-1', fakeFile);
            });

            // playFile awaits resume, then play() also checks suspended and calls resume.
            expect(ctx.resume).toHaveBeenCalled();
        });

        it('swallows decode errors gracefully (best-effort preview)', async () => {
            const { ctx } = makeFakeContext();
            ctx.decodeAudioData = vi.fn(() => Promise.reject(new Error('unsupported format')));
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            const fakeFile = {
                arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
            } as unknown as File;

            await expect(
                act(async () => {
                    await result.current.playFile('file-1', fakeFile);
                })
            ).resolves.toBeUndefined();

            // Nothing started playing.
            expect(ctx.createBufferSource).not.toHaveBeenCalled();
            expect(result.current.playingId).toBeNull();
        });
    });

    describe('stop', () => {
        it('stops and disconnects the current source and clears playingId', () => {
            const { ctx, oscillators } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            act(() => {
                result.current.playTone('preview-1', 440, 5);
            });

            const osc = oscillators[0]!;
            act(() => {
                result.current.stop();
            });

            expect(osc.stop).toHaveBeenCalled();
            expect(osc.disconnect).toHaveBeenCalled();
            expect(result.current.playingId).toBeNull();
        });

        it('is a no-op when nothing is playing', () => {
            const { ctx } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            expect(() =>
                act(() => {
                    result.current.stop();
                })
            ).not.toThrow();
            expect(result.current.playingId).toBeNull();
        });

        it('stops the previous source when starting a new playback', () => {
            const { ctx, oscillators } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            act(() => {
                result.current.playTone('tone-1', 220, 5);
            });
            act(() => {
                result.current.playTone('tone-2', 440, 5);
            });

            // The first oscillator must have been stopped by the second play call.
            expect(oscillators[0]!.stop).toHaveBeenCalled();
            expect(result.current.playingId).toBe('tone-2');
        });

        it('does not throw when stop() is called on an already-stopped node', () => {
            const { ctx, oscillators } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result } = renderHook(() => usePreviewAudio());
            act(() => {
                result.current.playTone('tone-1', 220, 5);
            });

            // Make stop() throw on the node (simulates already-stopped).
            oscillators[0]!.stop = vi.fn(() => {
                throw new Error('already stopped');
            });

            expect(() =>
                act(() => {
                    result.current.stop();
                })
            ).not.toThrow();
        });
    });

    describe('unmount cleanup', () => {
        it('stops and disconnects a sounding preview node when the component unmounts', () => {
            const { ctx, oscillators } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result, unmount } = renderHook(() => usePreviewAudio());

            act(() => {
                result.current.playTone('preview-1', 440, 5);
            });

            expect(oscillators).toHaveLength(1);
            const osc = oscillators[0]!;
            expect(osc.disconnect).not.toHaveBeenCalled();

            unmount();

            expect(osc.stop).toHaveBeenCalled();
            expect(osc.disconnect).toHaveBeenCalledTimes(1);
        });

        it('does not throw on unmount when nothing is playing', () => {
            const { ctx } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { unmount } = renderHook(() => usePreviewAudio());

            expect(() => unmount()).not.toThrow();
        });

        it('does not throw on unmount when stop() on the node throws', () => {
            const { ctx, oscillators } = makeFakeContext();
            vi.mocked(getAudioContext).mockReturnValue(ctx as unknown as AudioContext);

            const { result, unmount } = renderHook(() => usePreviewAudio());
            act(() => {
                result.current.playTone('preview-1', 440, 5);
            });
            oscillators[0]!.stop = vi.fn(() => {
                throw new Error('already stopped');
            });

            expect(() => unmount()).not.toThrow();
        });
    });
});
