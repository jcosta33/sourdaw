import { type RefObject, createRef } from 'react';

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getDawStatusDotClassName } from '#/components/daw/DawStatusDot';
import { getEngineDiagnostics, getEngineState, subscribePeakMeter } from '#/modules/AudioEngine/useCases';

import { useStatusBarMetrics, type StatusBarMetricRefs } from '../useStatusBarMetrics';

type TickFn = Parameters<typeof subscribePeakMeter>[0]['onFrame'];

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getEngineDiagnostics: vi.fn(),
    getEngineState: vi.fn(),
    subscribePeakMeter: vi.fn(),
}));

let capturedTick: TickFn | null = null;
const unsubscribe = vi.fn();

function runTick(peak = 0): void {
    capturedTick?.(peak, 0, 16);
}

function makeRefs(): StatusBarMetricRefs {
    return {
        cpuBar: createRef<HTMLDivElement>(),
        cpuText: createRef<HTMLSpanElement>(),
        memContainer: createRef<HTMLDivElement>(),
        memText: createRef<HTMLSpanElement>(),
        sampleRate: createRef<HTMLSpanElement>(),
        latency: createRef<HTMLSpanElement>(),
        masterLevelBar: createRef<HTMLDivElement>(),
        masterLevelText: createRef<HTMLSpanElement>(),
        engineState: createRef<HTMLSpanElement>(),
    };
}

function makeElements(refs: StatusBarMetricRefs): void {
    for (const ref of Object.values(refs) as Array<RefObject<HTMLElement | null>>) {
        const el = document.createElement('div');
        (ref as { current: HTMLElement | null }).current = el;
    }
}

function makeEngineDiagnostics(deviceInstances = 24): ReturnType<typeof getEngineDiagnostics> {
    return {
        context: { state: 'running', sampleRate: 48_000, baseLatency: 0.005, outputLatency: 0.005 },
        playback: {
            underrunDuration: 0,
            underrunEvents: 0,
            totalDuration: 30,
            averageLatency: 0.01,
            minimumLatency: 0.008,
            maximumLatency: 0.012,
        },
        graph: {
            trackStrips: 43,
            busStrips: 8,
            sends: 12,
            sidechains: 2,
            deviceInstances,
            pendingDeviceInstances: 1,
            failedDeviceInstances: 2,
            deviceInstancesByType: { fermenter: 14 },
            deviceAudioNodes: 31,
            deviceAudioWorkletProcessors: 24,
            deviceAudioWorkletProcessorsByType: { fermenter: 14 },
            meterTaps: 40,
            meterWorkletPools: 2,
            graphAudioWorkletProcessors: 64,
            workerInstances: 1,
            workerInstancesByType: { 'grand-boule': 1 },
            adjustmentLayerBuses: 0,
        },
        runtime: {
            trackedAudioScheduledSources: 0,
            processorLifecycle: { unmanaged: 24, continue: 0, continueIfNotQuiet: 0, tail: 0, sleep: 0 },
        },
    };
}

describe('useStatusBarMetrics', () => {
    const originalRequestIdle = globalThis.requestIdleCallback;
    const originalCancelIdle = globalThis.cancelIdleCallback;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.stubGlobal('performance', { now: vi.fn(() => 0) });
        // No requestIdleCallback by default — exercises the feature-detect branch.
        delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
        delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
        capturedTick = null;
        vi.mocked(subscribePeakMeter).mockImplementation(({ onFrame }) => {
            capturedTick = onFrame;
            return unsubscribe;
        });
        vi.mocked(getEngineDiagnostics).mockReturnValue(makeEngineDiagnostics());
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        globalThis.requestIdleCallback = originalRequestIdle;
        globalThis.cancelIdleCallback = originalCancelIdle;
    });

    it('writes the audio engine sample rate and latency to the DOM on tick', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
        });
        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        expect(capturedTick).not.toBeNull();
        runTick();

        // 48000 Hz → "48kHz"; 0.005s → 5.0ms.
        expect(refs.sampleRate.current!.textContent).toBe('48kHz');
        expect(refs.latency.current!.textContent).toBe('5.0ms');
    });

    it('writes the master level as dB (20*log10) and scales the bar width', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
        });
        // 0.5 amplitude → 20*log10(0.5) ≈ -6.0 dB.
        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        runTick(0.5);

        expect(refs.masterLevelText.current!.textContent).toContain('-6.0 dB');
        // 0.5 * 300 = 150, but the bar width is capped at Math.min(100, ...) → 100%.
        expect(refs.masterLevelBar.current!.style.width).toBe('100%');
    });

    it('shows -inf dB when the master level is zero', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
        });
        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        runTick();

        expect(refs.masterLevelText.current!.textContent).toBe('-∞ dB');
    });

    it('hides the memory container when performance.memory is unavailable', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
        });
        // performance.memory absent (non-Chrome) — default in jsdom.

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        runTick();

        expect(refs.memContainer.current!.style.display).toBe('none');
    });

    it('shows the memory container and writes MB when performance.memory is present', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
        });
        // 10 MB in bytes.
        vi.stubGlobal('performance', {
            now: () => 0,
            memory: { usedJSHeapSize: 10 * 1024 * 1024 },
        });

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        runTick();

        expect(refs.memContainer.current!.style.display).toBe('flex');
        expect(refs.memText.current!.textContent).toBe('10 MB');
    });

    it('sets the engine-state dot className to success when running', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
        });
        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        runTick();

        const expectedClass = getDawStatusDotClassName({ tone: 'success' });
        expect(refs.engineState.current!.className).toContain(expectedClass);
        expect(refs.engineState.current!.title).toBe(
            'Engine: running · audio track strips: 43 · bus strips: 8 · sends: 12 · sidechains: 2 · ready device instances: 24 (fermenter: 14) · pending device instances: 1 · failed device instances: 2 · device audio nodes: 31 · meter taps: 40 · meter worklet pools: 2 · adjustment-layer buses: 0 · tracked AudioScheduledSources: 0'
        );
    });

    it('sets the engine-state dot to muted when the engine is suspended', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'suspended',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
        });
        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        runTick();

        const expectedClass = getDawStatusDotClassName({ tone: 'muted' });
        expect(refs.engineState.current!.className).toContain(expectedClass);
        expect(refs.engineState.current!.title).toBe(
            'Engine: suspended · audio track strips: 43 · bus strips: 8 · sends: 12 · sidechains: 2 · ready device instances: 24 (fermenter: 14) · pending device instances: 1 · failed device instances: 2 · device audio nodes: 31 · meter taps: 40 · meter worklet pools: 2 · adjustment-layer buses: 0 · tracked AudioScheduledSources: 0'
        );
    });

    it('samples graph diagnostics at most once per second', () => {
        let now = 0;
        vi.stubGlobal('performance', { now: () => now });
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48_000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
        });
        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        runTick();
        const initialTitle = refs.engineState.current!.title;

        vi.mocked(getEngineDiagnostics).mockReturnValue(makeEngineDiagnostics(25));
        now = 500;
        runTick();
        expect(getEngineDiagnostics).toHaveBeenCalledTimes(1);
        expect(refs.engineState.current!.title).toBe(initialTitle);

        now = 1_000;
        runTick();
        expect(getEngineDiagnostics).toHaveBeenCalledTimes(2);
        expect(refs.engineState.current!.title).toContain('ready device instances: 25');
    });

    it('writes a CPU percentage text and applies the success color when CPU is low', () => {
        // frameDelta near 0 → frameLoad near 0 → cpuPct low (< 50 → success).
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
        });
        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        runTick();

        // CPU text is a percentage string.
        expect(refs.cpuText.current!.textContent).toMatch(/^\d+%$/);
        // Low CPU → success color class is present.
        expect(refs.cpuBar.current!.classList.contains('bg-[var(--color-state-success)]')).toBe(true);
    });

    it('unregisters the animation tick on unmount', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
        });
        const refs = makeRefs();
        makeElements(refs);
        const { unmount } = renderHook(() => useStatusBarMetrics(refs));

        const subscription = vi.mocked(subscribePeakMeter).mock.calls[0]?.[0];
        expect(subscription?.trackId).toBeNull();
        expect(typeof subscription?.onFrame).toBe('function');
        unmount();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('uses requestIdleCallback when available to measure idle load', () => {
        const idleCb = vi.fn();
        vi.stubGlobal('requestIdleCallback', idleCb);
        vi.stubGlobal('cancelIdleCallback', vi.fn());

        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
        });
        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        expect(idleCb).toHaveBeenCalled();
    });
});
