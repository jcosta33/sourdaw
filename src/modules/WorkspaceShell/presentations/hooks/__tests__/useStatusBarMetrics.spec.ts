import { type RefObject, createRef } from 'react';

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getDawStatusDotClassName } from '#/components/daw/DawStatusDot';
import {
    getEngineDiagnostics,
    getEngineHealth,
    getEngineState,
    getMasterPeakLevel,
    readNativeEngineStatus,
    readNativeOutputLatency,
    refreshEngineRtDiagnostics,
} from '#/modules/AudioEngine/useCases';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { useStatusBarMetrics, type StatusBarMetricRefs } from '../useStatusBarMetrics';

// The native diagnostics shape derives from the barrel's own contract rather
// than a cross-module model import.
type EngineRtDiagnostics = Exclude<Awaited<ReturnType<typeof refreshEngineRtDiagnostics>>, null>;

type TickFn = () => void;

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getEngineDiagnostics: vi.fn(),
    getEngineHealth: vi.fn(),
    getEngineState: vi.fn(),
    getMasterPeakLevel: vi.fn(),
    readNativeEngineStatus: vi.fn(() => ({ audibleCarrier: false, diagnostics: null })),
    readNativeOutputLatency: vi.fn(() => null),
    refreshEngineRtDiagnostics: vi.fn(() => Promise.resolve()),
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
        context: {
            state: 'running',
            sampleRate: 48_000,
            baseLatency: 0.005,
            outputLatency: 0.005,
            latencyProfile: 'lowLatency',
            latencyHint: 'interactive',
        },
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

function makeNativeDiagnostics(overrides: Partial<EngineRtDiagnostics> = {}): EngineRtDiagnostics {
    return {
        running: true,
        schedulerEventBufferOverflows: 0,
        arpeggiatorActiveNoteExhaustions: 0,
        effectIdCollisions: 0,
        unsupportedEffectAdditions: 0,
        unmappedSetParamCalls: 0,
        captureConsumerRefusals: 0,
        captureBlocksDropped: 0,
        captureInputUnderruns: 0,
        inputLatencyFrames: 0,
        sampleRate: 96_000,
        outputBufferFrames: 0,
        outputPathFrames: 0,
        outputStreamFault: null,
        events: [],
        ...overrides,
    };
}

type IdleCallbackFixture = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;

/**
 * Installs a controllable `requestIdleCallback`. The hook re-arms inside its
 * callback, so each `dispatchIdle` call hands it the next frame's idle
 * observation; a frame the test does not dispatch for is a frame in which the
 * browser found no idle time.
 */
function stubIdleLoop(): { dispatchIdle: (timeRemainingMs: number) => void } {
    let callback: IdleCallbackFixture | null = null;
    vi.stubGlobal('requestIdleCallback', (cb: IdleCallbackFixture) => {
        callback = cb;
        return 1;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    return {
        dispatchIdle: (timeRemainingMs: number) => {
            callback?.({ didTimeout: false, timeRemaining: () => timeRemainingMs });
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
        vi.mocked(readNativeEngineStatus).mockReturnValue({ audibleCarrier: false, diagnostics: null });
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
            outputLatency: 0.003,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        expect(capturedTick).not.toBeNull();
        capturedTick!();

        // 48000 Hz → "48kHz"; 0.005s context + 0.003s device → 8.0ms heard.
        expect(refs.sampleRate.current!.textContent).toBe('48kHz');
        expect(refs.latency.current!.textContent).toBe('8.0ms');
    });

    // ── Output latency readout ───────────────────────────────────────────
    // Web Audio splits the output path into two disjoint successive segments:
    // `baseLatency` (AudioDestinationNode → audio subsystem) and `outputLatency`
    // (UA hands the host a buffer → the device plays its first sample). The delay
    // a user hears is the sum. The fixture below keeps them different and non-zero
    // so "base only" (5.3ms), "device only" (10.7ms) and "the sum" (16.0ms) are
    // three distinguishable readouts: 256 and 512 frames at 48 kHz.
    const BASE_LATENCY_SECONDS = 256 / 48_000; // 5.333… ms
    const OUTPUT_LATENCY_SECONDS = 512 / 48_000; // 10.666… ms

    it('reports the sum of context and device latency, not baseLatency alone', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: BASE_LATENCY_SECONDS,
            outputLatency: OUTPUT_LATENCY_SECONDS,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();

        // 5.333ms + 10.667ms = 16.0ms. Reporting either term alone reads 5.3ms or 10.7ms.
        expect(refs.latency.current!.textContent).toBe('16.0ms');
    });

    it('breaks the latency readout down into its context and device terms in the tooltip', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: BASE_LATENCY_SECONDS,
            outputLatency: OUTPUT_LATENCY_SECONDS,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();

        expect(refs.latency.current!.title).toBe(
            'Output latency 16.0 ms = context 5.3 ms + device 10.7 ms.' +
                ' Hardware output path only — excludes plug-in delay compensation.'
        );
    });

    it('falls back to the context term alone when the engine reports no device latency', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: false,
            sampleRate: 44100,
            state: 'closed',
            masterGain: 0,
            currentTime: 0,
            baseLatency: BASE_LATENCY_SECONDS,
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();

        // Sum, not a fixed device allowance: a 0 device term must subtract nothing.
        expect(refs.latency.current!.textContent).toBe('5.3ms');
        expect(refs.latency.current!.title).toContain('device 0.0 ms');
    });

    // Sibling of the text-node test below: this hook exists to avoid touching
    // unchanged DOM at animation-frame rate, and the latency tooltip is a string
    // that only moves when the device buffer does.
    // ── Native carrier readout ───────────────────────────────────────────
    // Once the native session becomes the audible carrier, Web Audio's own
    // context/device figures describe a path nobody hears, so the readout
    // switches to `readNativeOutputLatency`'s reading instead — see
    // `describeOutputLatency` in `useStatusBarMetrics.ts`.
    it('reads the native engine figure instead of Web Audio once the native session carries the monitor', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: BASE_LATENCY_SECONDS,
            outputLatency: OUTPUT_LATENCY_SECONDS,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(readNativeEngineStatus).mockReturnValue({
            audibleCarrier: true,
            diagnostics: makeNativeDiagnostics(),
        });
        vi.mocked(readNativeOutputLatency).mockReturnValue({
            contextSeconds: 256 / 48_000,
            deviceSeconds: 528 / 48_000,
        });

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();

        // 5.333ms + 11.0ms = 16.3ms — the native reading, not the 16.0ms the
        // Web Audio fixture above would have produced.
        expect(refs.latency.current!.textContent).toBe('16.3ms');
        expect(refs.latency.current!.title).toBe(
            'Output latency 16.3 ms = native engine buffer 5.3 ms + device 11.0 ms.' +
                ' Hardware output path only — excludes plug-in delay compensation.'
        );
    });

    it('falls back to the Web Audio reading while readNativeOutputLatency reports null', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: BASE_LATENCY_SECONDS,
            outputLatency: OUTPUT_LATENCY_SECONDS,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(readNativeOutputLatency).mockReturnValue(null);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();

        expect(refs.latency.current!.textContent).toBe('16.0ms');
        expect(refs.latency.current!.title).toBe(
            'Output latency 16.0 ms = context 5.3 ms + device 10.7 ms.' +
                ' Hardware output path only — excludes plug-in delay compensation.'
        );
    });

    it('labels the Web Audio rate readout as the context while Web Audio is the carrier', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        expect(refs.sampleRate.current!.textContent).toBe('48kHz');
        expect(refs.sampleRate.current!.title).toBe('Web Audio context sample rate');
    });

    // ── Native carrier provenance (#3706) ────────────────────────────────
    // While the native session is the audible carrier, Web Audio's context
    // rate/latency/state describe a path nobody hears. The readouts must name
    // their source, follow the carrier, and say n/a when the carrier has
    // published nothing — never substitute the other engine's number.
    it('shows the native output-stream rate, named as such, once the native session carries the monitor', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(readNativeEngineStatus).mockReturnValue({
            audibleCarrier: true,
            diagnostics: makeNativeDiagnostics({ sampleRate: 96_000 }),
        });

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        expect(refs.sampleRate.current!.textContent).toBe('96kHz');
        expect(refs.sampleRate.current!.title).toBe('Native engine output stream rate');
    });

    it('shows n/a — never the Web Audio context rate — when the native carrier has published no rate', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(readNativeEngineStatus).mockReturnValue({ audibleCarrier: true, diagnostics: null });

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        expect(refs.sampleRate.current!.textContent).toBe('n/a');
        expect(refs.sampleRate.current!.title).toBe('Native engine output stream rate');
    });

    it('shows n/a rather than the Web Audio latency while the native carrier has published no figure', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: BASE_LATENCY_SECONDS,
            outputLatency: OUTPUT_LATENCY_SECONDS,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(readNativeEngineStatus).mockReturnValue({ audibleCarrier: true, diagnostics: null });
        vi.mocked(readNativeOutputLatency).mockReturnValue(null);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        expect(refs.latency.current!.textContent).toBe('n/a');
        expect(refs.latency.current!.title).toContain('Native engine is the audible output');
        // The context figures would have read 16.0ms; they must not appear.
        expect(refs.latency.current!.title).not.toContain('context 5.3 ms');
    });

    it('reads the engine dot from the native engine while it is the audible carrier', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(readNativeEngineStatus).mockReturnValue({
            audibleCarrier: true,
            diagnostics: makeNativeDiagnostics(),
        });

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        expect(refs.engineState.current!.className).toContain(getDawStatusDotClassName({ tone: 'success' }));
        expect(refs.engineState.current!.title).toContain('Engine: native running · Web Audio: running');
    });

    it('marks the dot warning while the native output stream reports a fault', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(readNativeEngineStatus).mockReturnValue({
            audibleCarrier: true,
            diagnostics: makeNativeDiagnostics({ outputStreamFault: 'deviceChanged' }),
        });

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        expect(refs.engineState.current!.className).toContain(getDawStatusDotClassName({ tone: 'warning' }));
        expect(refs.engineState.current!.title).toContain('native output stream fault: deviceChanged');
    });

    it('marks the dot danger when the native carrier stopped rendering', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(readNativeEngineStatus).mockReturnValue({
            audibleCarrier: true,
            diagnostics: makeNativeDiagnostics({ running: false }),
        });

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        expect(refs.engineState.current!.className).toContain(getDawStatusDotClassName({ tone: 'danger' }));
        expect(refs.engineState.current!.title).toContain('Engine: native stopped');
    });

    it('keeps the dot muted — not failed — before any native diagnostics reading has landed', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        vi.mocked(readNativeEngineStatus).mockReturnValue({ audibleCarrier: true, diagnostics: null });

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        expect(refs.engineState.current!.className).toContain(getDawStatusDotClassName({ tone: 'muted' }));
        expect(refs.engineState.current!.title).toContain('Engine: native (no reading yet)');
    });

    it('leaves the latency tooltip alone while the latency is unchanged', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: BASE_LATENCY_SECONDS,
            outputLatency: OUTPUT_LATENCY_SECONDS,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        const latencyElement = refs.latency.current!;
        const titleWrites: string[] = [];
        let storedTitle = '';
        Object.defineProperty(latencyElement, 'title', {
            configurable: true,
            get: () => storedTitle,
            set: (value: string) => {
                storedTitle = value;
                titleWrites.push(value);
            },
        });
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();
        capturedTick!();
        capturedTick!();

        expect(titleWrites).toEqual([
            'Output latency 16.0 ms = context 5.3 ms + device 10.7 ms.' +
                ' Hardware output path only — excludes plug-in delay compensation.',
        ]);
    });

    it('rewrites the latency tooltip when the device buffer changes', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: BASE_LATENCY_SECONDS,
            outputLatency: OUTPUT_LATENCY_SECONDS,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();
        // The spec allows outputLatency to change while the context runs.
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: BASE_LATENCY_SECONDS,
            outputLatency: 1024 / 48_000,
        });
        capturedTick!();

        expect(refs.latency.current!.textContent).toBe('26.7ms');
        expect(refs.latency.current!.title).toBe(
            'Output latency 26.7 ms = context 5.3 ms + device 21.3 ms.' +
                ' Hardware output path only — excludes plug-in delay compensation.'
        );
    });

    it('preserves metric text nodes when consecutive ticks render the same values', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
            outputLatency: 0,
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
            outputLatency: 0,
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

    it('shows "n/a" — never a dB reading — when the master meter is unavailable', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
            outputLatency: 0.02,
        });
        // No meter tap: the engine cannot say what the output level is. Rendering
        // "-∞ dB" here is a lie — it is the readout for a genuinely silent mix, so
        // a user with audio playing reads it as "the engine is dead" and debugs the
        // wrong thing (ADR 0012: no silent downgrade).
        vi.mocked(getMasterPeakLevel).mockReturnValue(null);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        expect(refs.masterLevelText.current!.textContent).toBe('n/a');
        expect(refs.masterLevelBar.current!.style.width).toBe('0%');
    });

    it('shows -inf dB when the master level is zero', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
            outputLatency: 0,
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
            outputLatency: 0,
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
            outputLatency: 0,
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
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        const expectedClass = getDawStatusDotClassName({ tone: 'success' });
        expect(refs.engineState.current!.className).toContain(expectedClass);
        // While Web Audio is the audible engine the dot answers for Web Audio,
        // and the tooltip names it (#3706).
        expect(refs.engineState.current!.title).toBe(
            'Engine: Web Audio running · audio track strips: 43 · bus strips: 8 · sends: 12 · sidechains: 2 · ready device instances: 24 (fermenter: 14) · pending device instances: 1 · failed device instances: 2 · device audio nodes: 31 · strip meter worklets: 39 · master meter worklets: 1 · adjustment-layer buses: 0 · tracked AudioScheduledSources: 0 · missed render deadlines: 0 (0.0 ms) · engine-detected dropouts: 0'
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
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        capturedTick!();

        const expectedClass = getDawStatusDotClassName({ tone: 'muted' });
        expect(refs.engineState.current!.className).toContain(expectedClass);
        expect(refs.engineState.current!.title).toBe(
            'Engine: Web Audio suspended · audio track strips: 43 · bus strips: 8 · sends: 12 · sidechains: 2 · ready device instances: 24 (fermenter: 14) · pending device instances: 1 · failed device instances: 2 · device audio nodes: 31 · strip meter worklets: 39 · master meter worklets: 1 · adjustment-layer buses: 0 · tracked AudioScheduledSources: 0 · missed render deadlines: 0 (0.0 ms) · engine-detected dropouts: 0'
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
            outputLatency: 0,
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
            outputLatency: 0,
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
            outputLatency: 0,
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
            outputLatency: 0,
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

    it('drains the native engine event ring on the same once-per-second cadence', () => {
        // The ring is bounded and only this call empties it. With no production
        // caller it fills once and silently drops every later stream error, so
        // the drain running on the tick is the whole point of the reader.
        let now = 0;
        vi.stubGlobal('performance', { now: () => now });
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 48_000,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.005,
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        capturedTick!();
        expect(refreshEngineRtDiagnostics).toHaveBeenCalledTimes(1);

        now = 500;
        capturedTick!();
        expect(refreshEngineRtDiagnostics).toHaveBeenCalledTimes(1);

        now = 1_000;
        capturedTick!();
        expect(refreshEngineRtDiagnostics).toHaveBeenCalledTimes(2);
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
            outputLatency: 0,
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

    // ── Main-thread load estimate (#3705) ────────────────────────────────
    // The readout is a main-thread busyness estimate. Its inputs are
    // cadence-normalized: equivalent idle/work fractions must read the same
    // at 30, 60, and 120 Hz — the old fixed 50 ms idle budget and fixed
    // 60 Hz overrun budget classified an almost-idle UI as heavily loaded
    // purely from display cadence. These specs fail against that formula.
    function driveFrames(
        frameCount: number,
        intervalMs: number,
        idleMs: number | null,
        dispatchIdle: (timeRemainingMs: number) => void
    ): void {
        for (let frame = 0; frame < frameCount; frame++) {
            drivenNowMs += intervalMs;
            if (idleMs !== null) {
                // The browser found idle time this frame and dispatched the
                // callback with that much of it left.
                dispatchIdle(idleMs);
            }
            capturedTick!();
        }
    }

    let drivenNowMs = 0;

    function renderHookWithClock(): { refs: StatusBarMetricRefs; dispatchIdle: (timeRemainingMs: number) => void } {
        drivenNowMs = 0;
        vi.stubGlobal('performance', { now: () => drivenNowMs });
        // Install the idle loop before mounting: the hook schedules its first
        // idle callback inside the effect.
        const idle = stubIdleLoop();
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);
        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));
        return { refs, dispatchIdle: idle.dispatchIdle };
    }

    const readPercent = (refs: StatusBarMetricRefs): number => {
        const text = refs.cpuText.current?.textContent ?? '';
        return Number(text.replace('%', ''));
    };

    it.each([
        ['60 Hz', 1000 / 60, 15],
        ['120 Hz', 1000 / 120, 7],
        ['30 Hz', 1000 / 30, 30],
    ])(
        'reads equivalent mostly-idle frames at %s as the same low load, not a cadence artifact',
        (_label, intervalMs, idleMs) => {
            const { refs, dispatchIdle } = renderHookWithClock();
            driveFrames(60, intervalMs, idleMs, dispatchIdle);

            const percent = readPercent(refs);
            expect(percent).toBeLessThanOrEqual(20);
            expect(refs.cpuBar.current!.classList.contains('bg-[var(--color-state-success)]')).toBe(true);
            expect(refs.cpuBar.current!.classList.contains('bg-[var(--color-state-danger)]')).toBe(false);
        }
    );

    it('reads sustained frames with no dispatched idle time as high scheduling pressure', () => {
        const { refs, dispatchIdle } = renderHookWithClock();
        // One serviced idle sample proves the idle loop is live; afterwards
        // the main thread saturates while rAF keeps its cadence — no idle
        // callback is dispatched again.
        driveFrames(1, 1000 / 60, 15, dispatchIdle);
        driveFrames(40, 1000 / 60, null, dispatchIdle);

        const percent = readPercent(refs);
        expect(percent).toBeGreaterThanOrEqual(80);
        expect(refs.cpuBar.current!.classList.contains('bg-[var(--color-state-danger)]')).toBe(true);
    });

    it('does not read full pressure before the idle loop has proven it is serviced', () => {
        const { refs, dispatchIdle } = renderHookWithClock();
        // No idle callback ever dispatched: with no idle observation at all,
        // missing idle says nothing about busyness.
        driveFrames(40, 1000 / 60, null, dispatchIdle);

        expect(readPercent(refs)).toBeLessThanOrEqual(5);
    });

    it('reads a frame that overruns the display cadence as load even while its idle window was generous', () => {
        const { refs, dispatchIdle } = renderHookWithClock();
        driveFrames(30, 1000 / 60, 15, dispatchIdle); // establish the 60 Hz cadence
        // Acute jank: frames ~4x the display cadence, but almost entirely
        // idle — only the overrun term can see this as pressure.
        driveFrames(25, 1000 / 15, 63, dispatchIdle);

        const percent = readPercent(refs);
        expect(percent).toBeGreaterThanOrEqual(50);
        expect(refs.cpuBar.current!.classList.contains('bg-[var(--color-state-success)]')).toBe(false);
    });

    it('unregisters the animation tick on unmount', () => {
        vi.mocked(getEngineState).mockReturnValue({
            isReady: true,
            sampleRate: 44100,
            state: 'running',
            masterGain: 1,
            currentTime: 0,
            baseLatency: 0.01,
            outputLatency: 0,
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
            outputLatency: 0,
        });
        vi.mocked(getMasterPeakLevel).mockReturnValue(0);

        const refs = makeRefs();
        makeElements(refs);
        renderHook(() => useStatusBarMetrics(refs));

        expect(idleCb).toHaveBeenCalled();
    });
});
