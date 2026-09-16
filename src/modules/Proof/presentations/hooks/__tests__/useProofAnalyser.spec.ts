import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useProofAnalyser } from '../useProofAnalyser';

const mocks = vi.hoisted(() => ({
    // Kept mocked (and never wired up) so every test can assert the hook never
    // taps the master bus: presenting the master spectrum as this instance's
    // own output is the defect this hook must not have.
    getMasterAnalyser: vi.fn(),
    getDeviceOutputNode: vi.fn(),
    getAudioSampleRate: vi.fn(() => 48000),
    isEngineAudioAvailable: vi.fn(() => true),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getMasterAnalyser: mocks.getMasterAnalyser,
    getDeviceOutputNode: mocks.getDeviceOutputNode,
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

type FakeDeviceNode = {
    context: FakeContext;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
};

function makeFakeDeviceNode(): {
    deviceNode: FakeDeviceNode;
    getCreatedAnalyser: () => FakeAnalyser | null;
} {
    let created: FakeAnalyser | null = null;
    const deviceNode: FakeDeviceNode = {
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
    return { deviceNode, getCreatedAnalyser: () => created };
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
        mocks.getDeviceOutputNode.mockReturnValue(null);
        mocks.getMasterAnalyser.mockReturnValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('reports the fixed high-resolution FFT size and the engine sample rate without any device node', () => {
        mocks.getDeviceOutputNode.mockReturnValue(null);
        mocks.getAudioSampleRate.mockReturnValue(44100);

        const { result } = renderHook(() => useProofAnalyser('proof-1'));

        expect(result.current.fftData).toBeNull();
        expect(result.current.fftVersion).toBe(0);
        expect(result.current.sampleRate).toBe(44100);
        expect(result.current.fftSize).toBe(4096);
    });

    it('taps the instance output node and never the master bus analyser', () => {
        // A Proof on a drum bus must draw this chain's spectrum. Reading the
        // master analyser instead presented the whole mix as the instance's
        // own output, so the master tap is forbidden outright — even when a
        // master analyser exists and would connect without error.
        const { deviceNode, getCreatedAnalyser } = makeFakeDeviceNode();
        const masterNode = { context: deviceNode.context, connect: vi.fn(), disconnect: vi.fn() };
        mocks.getDeviceOutputNode.mockReturnValue(deviceNode);
        mocks.getMasterAnalyser.mockReturnValue(masterNode);
        captureAnimationFrames();

        renderHook(() => useProofAnalyser('proof-1'));

        const analyser = getCreatedAnalyser();
        expect(analyser?.fftSize).toBe(4096);
        expect(analyser?.smoothingTimeConstant).toBeCloseTo(0.85);
        expect(deviceNode.connect).toHaveBeenCalledWith(analyser);
        expect(masterNode.connect).not.toHaveBeenCalled();
        expect(mocks.getMasterAnalyser).not.toHaveBeenCalled();
    });

    it('configures the tap analyser to 4096-point FFT with heavy smoothing on the device output', () => {
        const { deviceNode, getCreatedAnalyser } = makeFakeDeviceNode();
        mocks.getDeviceOutputNode.mockReturnValue(deviceNode);
        captureAnimationFrames();

        renderHook(() => useProofAnalyser('proof-1'));

        const analyser = getCreatedAnalyser();
        expect(analyser?.fftSize).toBe(4096);
        expect(analyser?.smoothingTimeConstant).toBeCloseTo(0.85);
        expect(deviceNode.connect).toHaveBeenCalledWith(analyser);
    });

    it('throttles to one publish every fourth frame and exposes the mutated FFT buffer', () => {
        const { deviceNode } = makeFakeDeviceNode();
        mocks.getDeviceOutputNode.mockReturnValue(deviceNode);
        const { callbacks } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser('proof-1'));

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
        const { deviceNode } = makeFakeDeviceNode();
        mocks.getDeviceOutputNode.mockReturnValue(deviceNode);
        const { callbacks } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser('proof-1'));

        runFrames(callbacks, 4);
        const firstBuffer = result.current.fftData;
        const firstVersion = result.current.fftVersion;

        runFrames(callbacks, 4);
        expect(result.current.fftData).toBe(firstBuffer);
        expect(result.current.fftVersion).toBe(firstVersion + 1);
    });

    it('reports an unavailable tap with no device node at all', () => {
        mocks.getDeviceOutputNode.mockReturnValue(null);

        const { result } = renderHook(() => useProofAnalyser('proof-1'));

        expect(result.current.status).toBe('unavailable');
    });

    it('reports an unavailable tap and never connects when the engine runs its fallback shim', () => {
        // The shim hands out a structurally real analyser on a context that never
        // renders, so connecting to it succeeds and reads back silence forever.
        // Only the engine's own verdict separates that from a live device.
        const { deviceNode } = makeFakeDeviceNode();
        mocks.getDeviceOutputNode.mockReturnValue(deviceNode);
        mocks.isEngineAudioAvailable.mockReturnValue(false);
        const { rafSpy } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser('proof-1'));

        expect(result.current.status).toBe('unavailable');
        expect(deviceNode.connect).not.toHaveBeenCalled();
        expect(rafSpy).not.toHaveBeenCalled();
        expect(result.current.fftData).toBeNull();
    });

    it('reports an active tap on its very first render, before any frame is delivered', () => {
        const { deviceNode } = makeFakeDeviceNode();
        mocks.getDeviceOutputNode.mockReturnValue(deviceNode);
        const { callbacks } = captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser('proof-1'));

        // No transient `unavailable`: the panel would paint the dead-tap notice
        // over a working analyser for one frame on every entry to the Lab desk.
        expect(result.current.status).toBe('active');

        runFrames(callbacks, 4);

        expect(result.current.status).toBe('active');
        expect(result.current.fftData).not.toBeNull();
    });

    it('raises an unavailable tap once the device worklet finishes loading', () => {
        // A panel opened while the WASM worklet is still loading has no graph
        // node yet: the notice is truthful, and the hook must come alive by
        // itself once the node lands instead of staying dead until reopen.
        vi.useFakeTimers();
        const { deviceNode } = makeFakeDeviceNode();
        mocks.getDeviceOutputNode.mockReturnValueOnce(null).mockReturnValue(deviceNode);
        captureAnimationFrames();

        const { result } = renderHook(() => useProofAnalyser('proof-1'));
        expect(result.current.status).toBe('unavailable');

        act(() => {
            vi.advanceTimersByTime(250);
        });

        expect(result.current.status).toBe('active');
        expect(deviceNode.connect).toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('never polls for a node when the engine itself is unavailable', () => {
        vi.useFakeTimers();
        const setIntervalSpy = vi.spyOn(window, 'setInterval');
        mocks.getDeviceOutputNode.mockReturnValue(null);
        mocks.isEngineAudioAvailable.mockReturnValue(false);
        captureAnimationFrames();

        renderHook(() => useProofAnalyser('proof-1'));

        // Fallback mode is permanent: polling would raise the status on a
        // graph that can never carry a tap.
        expect(setIntervalSpy).not.toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('cancels the frame loop and detaches the tap on unmount', () => {
        const { deviceNode, getCreatedAnalyser } = makeFakeDeviceNode();
        mocks.getDeviceOutputNode.mockReturnValue(deviceNode);
        captureAnimationFrames();
        const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');

        const { unmount } = renderHook(() => useProofAnalyser('proof-1'));
        const analyser = getCreatedAnalyser();

        unmount();

        expect(cancelSpy).toHaveBeenCalled();
        expect(analyser?.disconnect).toHaveBeenCalled();
        expect(deviceNode.disconnect).toHaveBeenCalledWith(analyser);
    });
});
