import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { getEngineRtDiagnostics } from '../getEngineRtDiagnostics';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * The exact payload `engine_rt_diagnostics` emits. Pinned against the Rust
 * wire-shape test in `src-tauri/src/commands/engine_diagnostics.rs`: both sides
 * are hand-maintained, so a drift here is a drift in the contract.
 */
const nativePayload = {
    running: true,
    schedulerEventBufferOverflows: 1,
    arpeggiatorActiveNoteExhaustions: 2,
    effectIdCollisions: 3,
    unsupportedEffectAdditions: 4,
    unmappedSetParamCalls: 5,
    bridgeOutputBlocksDropped: 6,
    unmatchedBridgeBlocks: 7,
    bridgeBacklogBlocksShed: 8,
    callbackFramesOverBridgeReach: 9,
    bridgeInputBlocksRefused: 10,
    events: [{ type: 'streamError', kind: 'deviceNotAvailable' }],
};

describe('getEngineRtDiagnostics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('maps every counter and event of the native payload', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue(nativePayload);

        const diagnostics = await getEngineRtDiagnostics();

        expect(tauriInvoke).toHaveBeenCalledWith('engine_rt_diagnostics');
        expect(diagnostics).toEqual(nativePayload);
    });

    it('reports the not-running shape outside the desktop app', async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        const diagnostics = await getEngineRtDiagnostics();

        expect(tauriInvoke).not.toHaveBeenCalled();
        expect(diagnostics.running).toBe(false);
        expect(diagnostics.events).toEqual([]);
        expect(diagnostics.bridgeInputBlocksRefused).toBe(0);
    });

    it('reads a stopped engine as not running rather than as an absent reading', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue({
            ...nativePayload,
            running: false,
            events: [],
        });

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.running).toBe(false);
        expect(diagnostics.unmappedSetParamCalls).toBe(5);
    });

    it('keeps a stream error whose kind it does not recognize', async () => {
        // Dropping it would recreate the exact defect this surface exists to
        // fix: a stream that errored and left no trace.
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue({
            ...nativePayload,
            events: [{ type: 'streamError', kind: 'somethingCpalAddedLater' }],
        });

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.events).toEqual([{ type: 'streamError', kind: 'backendSpecific' }]);
    });

    it('reports an event whose type this build does not know instead of dropping it silently', async () => {
        // The union is hand-mirrored from Rust. An unmapped `type` cannot be
        // turned into a typed event, but a native side that grew a variant this
        // build never learned must not vanish without a trace.
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue({
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
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue(null);

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.running).toBe(false);
        expect(diagnostics.events).toEqual([]);
    });

    it('reads a missing or non-numeric counter as zero rather than as NaN', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue({
            running: true,
            unmappedSetParamCalls: 'many',
            events: 'not-a-list',
        });

        const diagnostics = await getEngineRtDiagnostics();

        expect(diagnostics.running).toBe(true);
        expect(diagnostics.unmappedSetParamCalls).toBe(0);
        expect(diagnostics.bridgeInputBlocksRefused).toBe(0);
        expect(diagnostics.events).toEqual([]);
    });
});
