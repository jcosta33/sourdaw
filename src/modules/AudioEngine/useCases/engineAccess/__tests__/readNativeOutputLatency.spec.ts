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
        outputDeviceLatencyFrames: 71,
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
        expect(readNativeOutputLatency()).toEqual({
            contextSeconds: 256 / 48_000,
            deviceSeconds: 71 / 48_000,
        });
    });

    it('reports zero device seconds when the device reported no figure, without treating it as no reading', () => {
        engineRtDiagnosticsStore.set({
            ...defaultEngineRtDiagnosticsState,
            latest: diagnostics({ outputDeviceLatencyFrames: 0 }),
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
