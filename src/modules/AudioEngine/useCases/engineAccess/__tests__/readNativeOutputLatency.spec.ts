import { beforeEach, describe, expect, it } from 'vitest';

import { defaultEngineRtDiagnosticsState, engineRtDiagnosticsStore } from '../../../stores/engineRtDiagnosticsStore';
import { nativeLiveGraphSession } from '../../livePlayback/nativeLiveGraphSessionState';
import { readNativeOutputLatency } from '../readNativeOutputLatency';

import type { EngineRtDiagnostics } from '../../../models/EngineRtDiagnostics';

function diagnostics(overrides: Partial<EngineRtDiagnostics> = {}): EngineRtDiagnostics {
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
        sampleRate: 48_000,
        outputBufferFrames: 256,
        outputPathFrames: 297,
        outputStreamFault: null,
        events: [],
        ...overrides,
    };
}

describe('readNativeOutputLatency', () => {
    beforeEach(() => {
        nativeLiveGraphSession.audibleCarrier = true;
        engineRtDiagnosticsStore.set({ ...defaultEngineRtDiagnosticsState, latest: diagnostics() });
    });

    it('splits the reading into the context buffer and the device figure, both in seconds', () => {
        const result = readNativeOutputLatency();

        expect(result?.contextSeconds).toEqual(256 / 48_000);
        expect(result?.deviceSeconds).toBeCloseTo(41 / 48_000);
    });

    // Mutation: drop `|| outputPathFrames <= 0` from the gate — this goes red
    // because the read then returns an object (deviceSeconds 0) instead of
    // null.
    it('measures nothing when the backend reports no output-path figure at all', () => {
        engineRtDiagnosticsStore.set({
            ...defaultEngineRtDiagnosticsState,
            latest: diagnostics({ outputPathFrames: 0 }),
        });

        expect(readNativeOutputLatency()).toBeNull();
    });

    it('clamps the device figure at zero when the output-path figure sits at or below the buffer, a backend fault rather than a negative device contribution', () => {
        engineRtDiagnosticsStore.set({
            ...defaultEngineRtDiagnosticsState,
            latest: diagnostics({ outputPathFrames: 100 }),
        });

        expect(readNativeOutputLatency()).toEqual({
            contextSeconds: 256 / 48_000,
            deviceSeconds: 0,
        });
    });

    it('measures nothing while the native session is not the audible carrier', () => {
        // Web Audio carries the monitor here, so the native stream's own
        // buffer and device latency describe a path nobody is hearing.
        nativeLiveGraphSession.audibleCarrier = false;

        expect(readNativeOutputLatency()).toBeNull();
    });

    it('measures nothing before a diagnostics reading has landed', () => {
        engineRtDiagnosticsStore.set(defaultEngineRtDiagnosticsState);

        expect(readNativeOutputLatency()).toBeNull();
    });

    it('measures nothing when the last reading reports the engine as not running', () => {
        engineRtDiagnosticsStore.set({
            ...defaultEngineRtDiagnosticsState,
            latest: diagnostics({ running: false }),
        });

        expect(readNativeOutputLatency()).toBeNull();
    });

    it('measures nothing before the stream has rendered a callback, when the buffer gauge still reads its startup zero', () => {
        engineRtDiagnosticsStore.set({
            ...defaultEngineRtDiagnosticsState,
            latest: diagnostics({ outputBufferFrames: 0 }),
        });

        expect(readNativeOutputLatency()).toBeNull();
    });

    it('measures nothing when the sample rate reads zero, which would otherwise divide by it', () => {
        engineRtDiagnosticsStore.set({
            ...defaultEngineRtDiagnosticsState,
            latest: diagnostics({ sampleRate: 0 }),
        });

        expect(readNativeOutputLatency()).toBeNull();
    });
});
