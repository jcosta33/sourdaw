import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import { getEngineRtDiagnostics } from '../getEngineRtDiagnostics';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    desktopInvoke: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * The exact payload `engine_rt_diagnostics` emits. Pinned against the Rust
 * wire-shape test in `crates/sourdaw-native/src/commands/engine_diagnostics.rs`: both sides
 * are hand-maintained, so a drift here is a drift in the contract.
 */
const nativePayload = {
    running: true,
    schedulerEventBufferOverflows: 1,
    arpeggiatorActiveNoteExhaustions: 2,
    effectIdCollisions: 3,
    unsupportedEffectAdditions: 4,
    unmappedSetParamCalls: 5,
    captureConsumerRefusals: 11,
    captureBlocksDropped: 12,
    captureInputUnderruns: 13,
    inputLatencyFrames: 14,
    sampleRate: 48_000,
    outputBufferFrames: 256,
    outputDeviceLatencyFrames: 128,
    outputStreamFault: 'deviceChanged',
    events: [{ type: 'streamError', side: 'input', kind: 'deviceNotAvailable' }],
};

describe('getEngineRtDiagnostics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('maps every counter and event of the native payload', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue(nativePayload);

        const diagnostics = await getEngineRtDiagnostics();

        expect(desktopInvoke).toHaveBeenCalledWith('engine_rt_diagnostics');
        expect(diagnostics).toEqual(nativePayload);
    });

    it('reports the not-running shape outside the desktop app', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        const diagnostics = await getEngineRtDiagnostics();

        expect(desktopInvoke).not.toHaveBeenCalled();
        expect(diagnostics.running).toBe(false);
        expect(diagnostics.events).toEqual([]);
        expect(diagnostics.captureConsumerRefusals).toBe(0);
    });

    it('reads a stopped engine as not running rather than as an absent reading', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue({
            ...nativePayload,
            running: false,
            events: [],
        });

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.running).toBe(false);
        expect(diagnostics.unmappedSetParamCalls).toBe(5);
        // A stalled output stream is exactly this shape: `running: false` on
        // an engine that still has a real fault to report, not the all-zeros
        // not-running default.
        expect(diagnostics.outputStreamFault).toBe('deviceChanged');
    });

    it('reads a recognized output-stream-fault kind', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue({ ...nativePayload, outputStreamFault: 'deviceChanged' });

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.outputStreamFault).toBe('deviceChanged');
    });

    it('reads a null output-stream-fault as no fault', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue({ ...nativePayload, outputStreamFault: null });

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.outputStreamFault).toBeNull();
    });

    it('reads a missing output-stream-fault as no fault', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        const { outputStreamFault: _omitted, ...payloadWithoutFault } = nativePayload;
        vi.mocked(desktopInvoke).mockResolvedValue(payloadWithoutFault);

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.outputStreamFault).toBeNull();
    });

    it('keeps an output-stream-fault kind it does not recognize', async () => {
        // The same honesty the event-kind fallback exists for: an unmapped
        // kind still means the stream reported something, so it must not be
        // reported as no fault at all.
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue({ ...nativePayload, outputStreamFault: 'somethingNew' });

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.outputStreamFault).toBe('backendSpecific');
    });

    it('keeps a stream error whose kind it does not recognize', async () => {
        // Dropping it would recreate the exact defect this surface exists to
        // fix: a stream that errored and left no trace.
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue({
            ...nativePayload,
            events: [{ type: 'streamError', side: 'output', kind: 'somethingCpalAddedLater' }],
        });

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.events).toEqual([{ type: 'streamError', side: 'output', kind: 'backendSpecific' }]);
    });

    it('reports an event whose type this build does not know instead of dropping it silently', async () => {
        // The union is hand-mirrored from Rust. An unmapped `type` cannot be
        // turned into a typed event, but a native side that grew a variant this
        // build never learned must not vanish without a trace.
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue({
            ...nativePayload,
            events: [{ type: 'xrunBurst', count: 4 }],
        });

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.events).toEqual([]);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"type":"xrunBurst"'));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"count":4'));
    });

    it('falls back to the not-running shape when the native payload is not an object', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue(null);

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.running).toBe(false);
        expect(diagnostics.events).toEqual([]);
    });

    it('reads a missing or non-numeric counter as zero rather than as NaN', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue({
            running: true,
            unmappedSetParamCalls: 'many',
            events: 'not-a-list',
        });

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.running).toBe(true);
        expect(diagnostics.unmappedSetParamCalls).toBe(0);
        expect(diagnostics.captureConsumerRefusals).toBe(0);
        expect(diagnostics.events).toEqual([]);
    });
});
