import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    restoreTrackSnapshot: vi.fn<(snapshot: unknown) => void>(),
    restoreMarkerSnapshot: vi.fn<(snapshot: unknown) => void>(),
    restoreAutomationSnapshot: vi.fn<(snapshot: unknown) => void>(),
    setMidiStoreState: vi.fn<(snapshot: unknown) => void>(),
    restoreTransportSnapshot: vi.fn<(snapshot: unknown) => void>(),
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    restoreTrackSnapshot: mocks.restoreTrackSnapshot,
    restoreMarkerSnapshot: mocks.restoreMarkerSnapshot,
}));
vi.mock('#/modules/Automation/useCases', () => ({
    restoreAutomationSnapshot: mocks.restoreAutomationSnapshot,
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    setMidiStoreState: mocks.setMidiStoreState,
}));
vi.mock('#/modules/Transport/useCases', () => ({
    restoreTransportSnapshot: mocks.restoreTransportSnapshot,
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

const { restoreSnapshot } = await import('../snapshotHelpers/restoreSnapshot');

describe('restoreSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates each present snapshot field to its owning module use case', () => {
        const payload = {
            tracks: { tracks: [], selectedTrackId: null },
            markers: { markers: [], sections: [] },
            transport: { tempo: 132 },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            automation: { lanes: [] },
        };

        restoreSnapshot({
            data: JSON.stringify(payload),
            size: 10,
        });

        expect(mocks.restoreTrackSnapshot).toHaveBeenCalledWith(payload.tracks);
        expect(mocks.restoreMarkerSnapshot).toHaveBeenCalledWith(payload.markers);
        expect(mocks.restoreTransportSnapshot).toHaveBeenCalledWith(payload.transport);
        expect(mocks.setMidiStoreState).toHaveBeenCalledWith(payload.midi);
        expect(mocks.restoreAutomationSnapshot).toHaveBeenCalledWith(payload.automation);
    });

    it('does not restore stores whose top-level snapshot fields are absent', () => {
        const tracks = { tracks: [], selectedTrackId: null };

        restoreSnapshot({
            data: JSON.stringify({ tracks }),
            size: 10,
        });

        expect(mocks.restoreTrackSnapshot).toHaveBeenCalledWith(tracks);
        expect(mocks.restoreMarkerSnapshot).not.toHaveBeenCalled();
        expect(mocks.restoreTransportSnapshot).not.toHaveBeenCalled();
        expect(mocks.setMidiStoreState).not.toHaveBeenCalled();
        expect(mocks.restoreAutomationSnapshot).not.toHaveBeenCalled();
    });

    it('should log when snapshot JSON is corrupt', () => {
        restoreSnapshot({ data: '{not json', size: 1 });

        expect(mocks.logger.error).toHaveBeenCalledWith(expect.any(Error));
    });
});
