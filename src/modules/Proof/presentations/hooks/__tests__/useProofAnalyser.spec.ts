import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useProofAnalyser } from '../useProofAnalyser';

const mocks = vi.hoisted(() => ({
    getMasterAnalyser: vi.fn(),
    getAudioSampleRate: vi.fn(() => 48000),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getMasterAnalyser: mocks.getMasterAnalyser,
    getAudioSampleRate: mocks.getAudioSampleRate,
}));

/** Records raw-frequency reads and lets a test spy on the created analyser. */
type FakeAnalyser = {
    fftSize: number;
    smoothingTimeConstant: number;
    frequencyBinCount: number;
    getFloatFrequencyData: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
};

type FakeContext = {
    createAnalyser: () => FakeAnalyser;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
    /** Fires the listeners the hook registered for the context's own events. */
    emit: (type: string) => void;
};

type FakeMaster = {
    context: FakeContext;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
};

function makeFakeMaster(options?: { connectThrows?: boolean }): {
    master: FakeMaster;
    getCreatedAnalyser: () => FakeAnalyser | null;
} {
    let created: FakeAnalyser | null = null;
    const listeners = new Map<string, Set<() => void>>();
    const master: FakeMaster = {
        context: {
            addEventListener: (type, listener) => {
                const existing = listeners.get(type) ?? new Set<() => void>();
                existing.add(listener);
                listeners.set(type, existing);
            },
            removeEventListener: (type, listener) => {
                listeners.get(type)?.delete(listener);
            },
            emit: (type) => {
                for (const listener of [...(listeners.get(type) ?? [])]) {
                    listener();
                }
            },
            createAnalyser: () => {
                created = {
                    fftSize: 2048,
                    smoothingTimeConstant: 0,
                    frequencyBinCount: 8,
                    // Fill the destination so the published array carries the fake signal.
                    getFloatFrequencyData: vi.fn((buffer: Float32Array) => {
                        buffer.fill(-42);
                    }),
                    disconnect: vi.fn(),
                };
                return created;
            },
        },
        connect: vi.fn(() => {
            if (options?.connectThrows) {
                throw new Error('context not running');
            }
        }),
        disconnect: vi.fn(),
    };
    return { master, getCreatedAnalyser: () => created };
}

function captureAnimationFrames(): { callbacks: FrameRequestCallback[]; rafSpy: ReturnType<typeof vi.spyOn> } {
    const callbacks: FrameRequestCallback[] = [];
    let nextId = 1;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        callbacks.push(callback);
        return nextId++;
    });
    return { callbacks, rafSpy };
}

/** Runs `count` raw-frame ticks; each tick reschedules the next via the spy. */
function runFrames(callbacks: FrameRequestCallback[], count: number): void {
    for (let i = 0; i < count; i++) {
        const next = callbacks.at(i);
        if (!next) {
            throw new Error(`No animation frame scheduled at index ${i}`);
        }
        act(() => {
            next(i);
        });
    }
}

describe('useProofAnalyser', () => {
    beforeEach(() => {
        mocks.getAudioSampleRate.mockReturnValue(48000);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('reports the fixed high-resolution FFT size and the engine sample rate without any master analyser', () => {
        mocks.getMasterAnalyser.mockReturnValue(null);
        mocks.getAudioSampleRate.mockReturnValue(44100);

        const { result } = renderHook(() => useProofAnalyser());

        expect(result.current.fftData).toBeNull();
        expect(result.current.fftVersion).toBe(0);
        expect(result.current.sampleRate).toBe(44100);
        expect(result.current.fftSize).toBe(4096);
    });

    it('configures the tap analyser to 4096-point FFT with heavy smoothing and connects it to master', () => {
        const { master, getCreatedAnalyser } = makeFakeMaster();
        mocks.getMasterAnalyser.mockReturnValue(master);
        captureAnimationFrames();

        renderHook(() => useProofAnalyser());

        const analyser = getCreatedAnalyser();
        expect(analyser?.fftSize).toBe(4096);
        expect(analyser?.smoothingTimeConstant).toBeCloseTo(0.85);
        expect(master.connect).toHaveBeenCalledWith(analyser);
    });

    it('throttles to one publish every fourth frame and exposes the mutated FFT buffer', () => {
        const { master } = makeFakeMaster();
        mocks.getMasterAnalyser.mockReturnValue(master);
        const { callbacks } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser());

        // First three frames are throttled away — no publish, version untouched.
        runFrames(callbacks, 3);
        expect(result.current.fftData).toBeNull();
        expect(result.current.fftVersion).toBe(0);

        // The fourth frame reads the analyser and publishes the buffer.
        runFrames(callbacks, 1);
        expect(result.current.fftData).not.toBeNull();
        expect(result.current.fftData?.length).toBe(8);
        expect(Array.from(result.current.fftData ?? [])).toEqual(Array.from<number>({ length: 8 }).fill(-42));
        expect(result.current.fftVersion).toBe(1);
    });

    it('keeps the buffer reference stable while bumping the version on each later publish', () => {
        const { master } = makeFakeMaster();
        mocks.getMasterAnalyser.mockReturnValue(master);
        const { callbacks } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser());

        runFrames(callbacks, 4);
        const firstBuffer = result.current.fftData;
        const firstVersion = result.current.fftVersion;

        runFrames(callbacks, 4);
        expect(result.current.fftData).toBe(firstBuffer);
        expect(result.current.fftVersion).toBe(firstVersion + 1);
    });

    it('never schedules a frame or publishes when connecting the tap throws', () => {
        const { master } = makeFakeMaster({ connectThrows: true });
        mocks.getMasterAnalyser.mockReturnValue(master);
        const { rafSpy } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser());

        expect(rafSpy).not.toHaveBeenCalled();
        expect(result.current.fftData).toBeNull();
        expect(result.current.status).toBe('unavailable');
    });

    it('reports an unavailable tap with no master analyser at all', () => {
        mocks.getMasterAnalyser.mockReturnValue(null);

        const { result } = renderHook(() => useProofAnalyser());

        expect(result.current.status).toBe('unavailable');
    });

    it('reports an active tap from its first delivered frame', () => {
        const { master } = makeFakeMaster();
        mocks.getMasterAnalyser.mockReturnValue(master);
        const { callbacks } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser());

        // A connected tap that has not produced a frame is not yet proof of a
        // working spectrum, so the panel starts on the honest state.
        expect(result.current.status).toBe('unavailable');

        runFrames(callbacks, 1);

        expect(result.current.status).toBe('active');
    });

    it('retries the failed tap when the audio context changes state', () => {
        let connectThrows = true;
        const { master } = makeFakeMaster();
        master.connect.mockImplementation(() => {
            if (connectThrows) {
                throw new Error('context not running');
            }
        });
        mocks.getMasterAnalyser.mockReturnValue(master);
        const { callbacks } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser());
        expect(result.current.status).toBe('unavailable');

        // A suspended context is why the tap failed; resuming it is the event
        // that makes the tap possible, so the display recovers without the
        // panel being torn down.
        connectThrows = false;
        act(() => {
            master.context.emit('statechange');
        });

        runFrames(callbacks, 4);

        expect(result.current.status).toBe('active');
        expect(result.current.fftData).not.toBeNull();
    });

    it('cancels the frame loop and detaches the tap on unmount', () => {
        const { master, getCreatedAnalyser } = makeFakeMaster();
        mocks.getMasterAnalyser.mockReturnValue(master);
        captureAnimationFrames();
        const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');

        const { unmount } = renderHook(() => useProofAnalyser());
        const analyser = getCreatedAnalyser();

        unmount();

        expect(cancelSpy).toHaveBeenCalled();
        expect(analyser?.disconnect).toHaveBeenCalled();
        expect(master.disconnect).toHaveBeenCalledWith(analyser);
    });
});
