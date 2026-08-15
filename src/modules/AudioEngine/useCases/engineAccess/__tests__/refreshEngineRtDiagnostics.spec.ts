import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getEngineRtDiagnostics } from '../../../repositories/engineDiagnostics/getEngineRtDiagnostics';
import {
    defaultEngineRtDiagnosticsState,
    ENGINE_EVENT_HISTORY_LIMIT,
    engineRtDiagnosticsStore,
} from '../../../stores/engineRtDiagnosticsStore';
import { refreshEngineRtDiagnostics } from '../refreshEngineRtDiagnostics';

import type { EngineRtDiagnostics } from '../../../models/EngineRtDiagnostics';

vi.mock('../../../repositories/engineDiagnostics/getEngineRtDiagnostics', () => ({
    getEngineRtDiagnostics: vi.fn(),
}));

function diagnostics(overrides: Partial<EngineRtDiagnostics> = {}): EngineRtDiagnostics {
    return {
        running: true,
        schedulerEventBufferOverflows: 0,
        arpeggiatorActiveNoteExhaustions: 0,
        effectIdCollisions: 0,
        unsupportedEffectAdditions: 0,
        unmappedSetParamCalls: 0,
        bridgeOutputBlocksDropped: 0,
        unmatchedBridgeBlocks: 0,
        bridgeBacklogBlocksShed: 0,
        callbackFramesOverBridgeReach: 0,
        bridgeInputBlocksRefused: 0,
        events: [],
        ...overrides,
    };
}

describe('refreshEngineRtDiagnostics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        engineRtDiagnosticsStore.set(defaultEngineRtDiagnosticsState);
    });

    it('publishes the latest reading to the store and returns it', async () => {
        const reading = diagnostics({ unmappedSetParamCalls: 4, bridgeInputBlocksRefused: 2 });
        vi.mocked(getEngineRtDiagnostics).mockResolvedValue(reading);

        const returned = await refreshEngineRtDiagnostics();

        expect(returned).toEqual(reading);
        expect(engineRtDiagnosticsStore.value?.latest).toEqual(reading);
    });

    it('starts with no reading rather than with a reading of all zeros', () => {
        expect(engineRtDiagnosticsStore.value?.latest).toBeNull();
    });

    it('accumulates drained events instead of replacing them', async () => {
        // The native command drains its ring, so each event is delivered once.
        // Replacing the list on every refresh would discard everything reported
        // before it.
        vi.mocked(getEngineRtDiagnostics).mockResolvedValueOnce(
            diagnostics({ events: [{ type: 'streamError', kind: 'xrun' }] })
        );
        await refreshEngineRtDiagnostics();

        vi.mocked(getEngineRtDiagnostics).mockResolvedValueOnce(
            diagnostics({ events: [{ type: 'streamError', kind: 'deviceNotAvailable' }] })
        );
        await refreshEngineRtDiagnostics();

        expect(engineRtDiagnosticsStore.value?.events).toEqual([
            { type: 'streamError', kind: 'xrun' },
            { type: 'streamError', kind: 'deviceNotAvailable' },
        ]);
    });

    it('keeps a refresh returning no events from clearing the history', async () => {
        vi.mocked(getEngineRtDiagnostics).mockResolvedValueOnce(
            diagnostics({ events: [{ type: 'streamError', kind: 'deviceChanged' }] })
        );
        await refreshEngineRtDiagnostics();

        vi.mocked(getEngineRtDiagnostics).mockResolvedValueOnce(diagnostics());
        await refreshEngineRtDiagnostics();

        expect(engineRtDiagnosticsStore.value?.events).toEqual([{ type: 'streamError', kind: 'deviceChanged' }]);
    });

    it('bounds the event history so a stream failing every period cannot grow it forever', async () => {
        const flood = Array.from({ length: ENGINE_EVENT_HISTORY_LIMIT + 5 }, () => ({
            type: 'streamError' as const,
            kind: 'xrun' as const,
        }));
        vi.mocked(getEngineRtDiagnostics).mockResolvedValueOnce(
            diagnostics({ events: [{ type: 'streamError', kind: 'deviceBusy' }, ...flood] })
        );

        await refreshEngineRtDiagnostics();

        const events = engineRtDiagnosticsStore.value?.events ?? [];
        expect(events).toHaveLength(ENGINE_EVENT_HISTORY_LIMIT);
        // The oldest reports are the ones dropped, so the newest are kept.
        expect(events.every((event) => event.kind === 'xrun')).toBe(true);
    });
});
