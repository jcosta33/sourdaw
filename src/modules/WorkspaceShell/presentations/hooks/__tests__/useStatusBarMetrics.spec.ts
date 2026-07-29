import { type RefObject, createRef } from 'react';

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getDawStatusDotClassName } from '#/components/daw/DawStatusDot';
import { getEngineDiagnostics, getEngineState, getMasterPeakLevel } from '#/modules/AudioEngine/useCases';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { useStatusBarMetrics, type StatusBarMetricRefs } from '../useStatusBarMetrics';

type TickFn = () => void;

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getEngineDiagnostics: vi.fn(),
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
        vi.mocked(getEngineDiagnostics).mockReturnValue({
            context: {
                state: 'running',
                sampleRate: 48_000,
                baseLatency: 0.005,
                outputLatency: 0.005,
            },
            graph: {
                trackStrips: 43,
                busStrips: 8,
                sends: 12,
                sidechains: 2,
                deviceInstances: 24,
                deviceInstancesByType: { fermenter: 14 },
                deviceAudioNodes: 31,
                stripMeterWorklets: 39,
                masterMeterWorklets: 1,
                adjustmentLayerBuses: 0,
            },
            runtime: {
                trackedAudioScheduledSources: 0,
            },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        if (originalRequestIdle) {
            (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = originalRequestIdle;
        }
        if (originalCancelIdle) {
            (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCancelIdle;
        }
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
            'Engine: running · 43 tracks · 8 buses · 24 devices · 40 meter worklets'
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
            'Engine: suspended · 43 tracks · 8 buses · 24 devices · 40 meter worklets'
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
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();
        now = 500;
        capturedTick!();
        expect(getEngineDiagnostics).toHaveBeenCalledTimes(1);

        now = 1_000;
        capturedTick!();
        expect(getEngineDiagnostics).toHaveBeenCalledTimes(2);
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
