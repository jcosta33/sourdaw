import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useProofAnalyser } from '../useProofAnalyser';

const mocks = vi.hoisted(() => ({
    getMasterAnalyser: vi.fn(),
    getAudioSampleRate: vi.fn(() => 48000),
    isEngineAudioAvailable: vi.fn(() => true),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getMasterAnalyser: mocks.getMasterAnalyser,
    getAudioSampleRate: mocks.getAudioSampleRate,
    isEngineAudioAvailable: mocks.isEngineAudioAvailable,
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
};

type FakeMaster = {
    context: FakeContext;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
};

function makeFakeMaster(): {
    master: FakeMaster;
    getCreatedAnalyser: () => FakeAnalyser | null;
} {
    let created: FakeAnalyser | null = null;
    const master: FakeMaster = {
        context: {
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
        connect: vi.fn(),
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
        mocks.isEngineAudioAvailable.mockReturnValue(true);
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

    it('reports an unavailable tap with no master analyser at all', () => {
        mocks.getMasterAnalyser.mockReturnValue(null);

        const { result } = renderHook(() => useProofAnalyser());

        expect(result.current.status).toBe('unavailable');
    });

    it('reports an unavailable tap and never connects when the engine runs its fallback shim', () => {
        // The shim hands out a structurally real analyser on a context that never
        // renders, so connecting to it succeeds and reads back silence forever.
        // Only the engine's own verdict separates that from a live master.
        const { master } = makeFakeMaster();
        mocks.getMasterAnalyser.mockReturnValue(master);
        mocks.isEngineAudioAvailable.mockReturnValue(false);
        const { rafSpy } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser());

        expect(result.current.status).toBe('unavailable');
        expect(master.connect).not.toHaveBeenCalled();
        expect(rafSpy).not.toHaveBeenCalled();
        expect(result.current.fftData).toBeNull();
    });

    it('reports an active tap on its very first render, before any frame is delivered', () => {
        const { master } = makeFakeMaster();
        mocks.getMasterAnalyser.mockReturnValue(master);
        const { callbacks } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser());

        // No transient `unavailable`: the panel would paint the dead-tap notice
        // over a working analyser for one frame on every entry to the Lab desk.
        expect(result.current.status).toBe('active');

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
