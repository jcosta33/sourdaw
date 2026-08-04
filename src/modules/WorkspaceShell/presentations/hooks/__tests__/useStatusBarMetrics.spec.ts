import { type RefObject, createRef } from 'react';

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getDawStatusDotClassName } from '#/components/daw/DawStatusDot';
import {
    getEngineDiagnostics,
    getEngineHealth,
    getEngineState,
    getMasterPeakLevel,
} from '#/modules/AudioEngine/useCases';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { useStatusBarMetrics, type StatusBarMetricRefs } from '../useStatusBarMetrics';

type TickFn = () => void;

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getEngineDiagnostics: vi.fn(),
    getEngineHealth: vi.fn(),
    getEngineState: vi.fn(),
    getMasterPeakLevel: vi.fn(),
}));

let capturedTick: TickFn | null = null;
let capturedId: string | null = null;

vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: vi.fn((id: string, cb: TickFn) => {
            capturedId = id;
            capturedTick = cb;
        }),
        unregister: vi.fn(),
    },
}));

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
            graphSlotResourcesByLoadState: {
                ready: { audioNodes: 29, audioWorkletProcessors: 24, workers: 1 },
                pending: { audioNodes: 1, audioWorkletProcessors: 0, workers: 0 },
                failed: { audioNodes: 1, audioWorkletProcessors: 0, workers: 0 },
            },
            deviceAudioWorkletProcessors: 24,
            deviceAudioWorkletProcessorsByType: { fermenter: 14 },
            stripMeterWorklets: 39,
            masterMeterWorklets: 1,
            graphAudioWorkletProcessors: 64,
            workerInstances: 1,
            workerInstancesByType: { 'grand-boule': 1 },
            adjustmentLayerBuses: 0,
            adjustmentLayerBusesByEffectType: {},
            adjustmentLayerAudioNodes: 0,
            adjustmentLayerAudioWorkletProcessors: 0,
        },
        runtime: {
            trackedAudioScheduledSources: 0,
            processorLifecycle: { unmanaged: 24, continue: 0, continueIfNotQuiet: 0, tail: 0, sleep: 0 },
        },
    };
}

function makeEngineHealth(detectedUnderrunBlocks = 0): ReturnType<typeof getEngineHealth> {
    return {
        workletReady: true,
        lastInitError: null,
        lastResumeError: null,
        dropouts: {
            detectedUnderrunBlocks,
            silentFrames: detectedUnderrunBlocks * 128,
            lastUnderrunAtFrame: detectedUnderrunBlocks > 0 ? 96_000 : 0,
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
        capturedId = null;
        vi.mocked(getEngineDiagnostics).mockReturnValue(makeEngineDiagnostics());
        vi.mocked(getEngineHealth).mockReturnValue(makeEngineHealth());
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = originalRequestIdle;
        (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCancelIdle;
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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        expect(capturedTick).not.toBeNull();
        capturedTick!();

        // 48000 Hz → "48kHz"; 0.005s → 5.0ms.
        expect(refs.sampleRate.current!.textContent).toBe('48kHz');
        expect(refs.latency.current!.textContent).toBe('5.0ms');
    });

    it('preserves metric text nodes when consecutive ticks render the same values', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();
        const sampleRateTextNode = refs.sampleRate.current!.firstChild;
        const latencyTextNode = refs.latency.current!.firstChild;

        capturedTick!();

        expect(refs.sampleRate.current!.firstChild).toBe(sampleRateTextNode);
        expect(refs.latency.current!.firstChild).toBe(latencyTextNode);
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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0.5);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        // performance.memory absent (non-Chrome) — default in jsdom.

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        // 10 MB in bytes.
        vi.stubGlobal('performance', {
            now: () => 0,
            memory: { usedJSHeapSize: 10 * 1024 * 1024 },
        });

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        const expectedClass = getDawStatusDotClassName({ tone: 'success' });
        expect(refs.engineState.current!.className).toContain(expectedClass);
        expect(refs.engineState.current!.title).toBe(
            'Engine: running · audio track strips: 43 · bus strips: 8 · sends: 12 · sidechains: 2 · ready device instances: 24 (fermenter: 14) · pending device instances: 1 · failed device instances: 2 · device audio nodes: 31 · strip meter worklets: 39 · master meter worklets: 1 · adjustment-layer buses: 0 · tracked AudioScheduledSources: 0 · missed render deadlines: 0 (0.0 ms) · engine-detected dropouts: 0'
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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        const expectedClass = getDawStatusDotClassName({ tone: 'muted' });
        expect(refs.engineState.current!.className).toContain(expectedClass);
        expect(refs.engineState.current!.title).toBe(
            'Engine: suspended · audio track strips: 43 · bus strips: 8 · sends: 12 · sidechains: 2 · ready device instances: 24 (fermenter: 14) · pending device instances: 1 · failed device instances: 2 · device audio nodes: 31 · strip meter worklets: 39 · master meter worklets: 1 · adjustment-layer buses: 0 · tracked AudioScheduledSources: 0 · missed render deadlines: 0 (0.0 ms) · engine-detected dropouts: 0'
        );
    });

    /**
     * The dropout readouts. Both signals were computed and discarded before
     * this: `getEngineDiagnostics().playback` sampled `AudioContext.playbackStats`
     * that nothing read, and `getEngineHealth()` had no production caller at all.
     *
     * What reds these four: deleting `+ dropoutSummary` from the tooltip
     * concatenation in `useStatusBarMetrics.ts`. Deleting only one of the two
     * signals from `describeDropouts` reds the pair that names it.
     */
    it('reports missed render deadlines and their duration in the engine tooltip', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48_000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        const diagnostics = makeEngineDiagnostics();
        vi.mocked(getEngineDiagnostics).mockReturnValue({
            ...diagnostics,
            playback: { ...diagnostics.playback!, underrunEvents: 941, underrunDuration: 5.018 },
        });

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        expect(refs.engineState.current!.title).toContain('missed render deadlines: 941 (5018.0 ms)');
    });

    it('reports the worklet-side engine-detected dropout tally separately from missed deadlines', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48_000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(getEngineHealth).mockReturnValue(makeEngineHealth(7));

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        const title = refs.engineState.current!.title;
        expect(title).toContain('engine-detected dropouts: 7');
        // The two counters measure different things and must not be merged.
        expect(title).toContain('missed render deadlines: 0 (0.0 ms)');
    });

    it('reports missed render deadlines as unavailable when there is no live AudioContext to sample', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: false,
            sampleRate: 48_000,
            state: 'suspended',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(getEngineDiagnostics).mockReturnValue({ ...makeEngineDiagnostics(), playback: null });
        vi.mocked(getEngineHealth).mockReturnValue(makeEngineHealth(3));

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        const title = refs.engineState.current!.title;
        expect(title).toContain('missed render deadlines: unavailable');
        expect(title).toContain('engine-detected dropouts: 3');
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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();
        const initialTitle = refs.engineState.current!.title;

        vi.mocked(getEngineDiagnostics).mockReturnValue(makeEngineDiagnostics(25));
        now = 500;
        capturedTick!();
        expect(getEngineDiagnostics).toHaveBeenCalledTimes(1);
        expect(refs.engineState.current!.title).toBe(initialTitle);

        now = 1_000;
        capturedTick!();
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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        const { unmount } = renderHook(() => useStatusBarMetrics(refs));

        expect(capturedId).not.toBeNull();
        unmount();

        expect(animationScheduler.unregister).toHaveBeenCalledWith(capturedId);
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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        expect(idleCb).toHaveBeenCalled();
    });
});
