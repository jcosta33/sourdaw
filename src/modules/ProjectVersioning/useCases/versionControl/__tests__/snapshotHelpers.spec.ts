import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const settledProjectId: { value: string | undefined } = {
        value: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
    };
    const markerStoreValue: { value: unknown } = { value: { markers: [], sections: [] } };
    const takeLaneStoreValue: { value: unknown } = { value: { lanes: [] } };
    const timeSignatureMapStoreValue: { value: unknown } = { value: { changes: [] } };
    return {
        restoreTrackSnapshot: vi.fn<(snapshot: unknown) => void>(),
        restoreArrangementMetadataSnapshot: vi.fn<(input: { markers?: unknown; takeLanes?: unknown }) => void>(),
        restoreAutomationSnapshot: vi.fn<(snapshot: unknown) => void>(),
        setMidiStoreState: vi.fn<(snapshot: unknown) => void>(),
        restoreTransportSnapshot: vi.fn<(snapshot: unknown) => void>(),
        restoreTimelineMapSnapshot: vi.fn<(input: { tempoMap?: unknown; timeSignatureMap?: unknown }) => void>(),
        markerStoreValue,
        takeLaneStoreValue,
        timeSignatureMapStoreValue,
        logger: {
            error: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        },
        project: { value: { initialized: true, loading: false } },
        settledProjectId,
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
    },
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
    },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    restoreTrackSnapshot: mocks.restoreTrackSnapshot,
    restoreArrangementMetadataSnapshot: mocks.restoreArrangementMetadataSnapshot,
}));
vi.mock('#/modules/Automation/useCases', () => ({
    restoreAutomationSnapshot: mocks.restoreAutomationSnapshot,
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    setMidiStoreState: mocks.setMidiStoreState,
}));
vi.mock('#/modules/Transport/stores', () => ({
    timeSignatureMapStore: {
        get value() {
            return mocks.timeSignatureMapStoreValue.value;
        },
    },
}));
vi.mock('#/modules/Transport/useCases', () => ({
    restoreTransportSnapshot: mocks.restoreTransportSnapshot,
    restoreTimelineMapSnapshot: mocks.restoreTimelineMapSnapshot,
}));
vi.mock('#/modules/Project/stores', () => ({
    getSettledProjectId: () => mocks.settledProjectId.value,
    projectStore: {
        get value() {
            return mocks.project.value;
        },
    },
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

const { restoreSnapshot } = await import('../snapshotHelpers/restoreSnapshot');

const OWNER_PROJECT_ID = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';

function snapshot(payload: unknown, ownerProjectId = OWNER_PROJECT_ID) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return { ownerProjectId, data, size: data.length };
}

describe('restoreSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.project.value = { initialized: true, loading: false };
        mocks.settledProjectId.value = OWNER_PROJECT_ID;
        mocks.markerStoreValue.value = { markers: [], sections: [] };
        mocks.takeLaneStoreValue.value = { lanes: [] };
        mocks.timeSignatureMapStoreValue.value = { changes: [] };
    });

    it('delegates each present snapshot field to its owning module use case', () => {
        const payload = {
            tracks: { tracks: [], selectedTrackId: null },
            markers: { markers: [], sections: [] },
            transport: { tempo: 132 },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            automation: { lanes: [] },
            tempoMap: { changes: [{ id: 'tempo-1', beat: 0, tempo: 60, curve: 'instant' }] },
            takeLanes: { lanes: [] },
        };

        expect(restoreSnapshot(snapshot(payload))).toBe(true);

        expect(mocks.restoreTrackSnapshot).toHaveBeenCalledWith(payload.tracks);
        expect(mocks.restoreArrangementMetadataSnapshot).toHaveBeenCalledWith({
            markers: payload.markers,
            takeLanes: payload.takeLanes,
        });
        expect(mocks.restoreTransportSnapshot).toHaveBeenCalledWith(payload.transport);
        expect(mocks.setMidiStoreState).toHaveBeenCalledWith(payload.midi);
        expect(mocks.restoreAutomationSnapshot).toHaveBeenCalledWith(payload.automation);
        expect(mocks.restoreTimelineMapSnapshot).toHaveBeenCalledWith({
            tempoMap: payload.tempoMap,
            timeSignatureMap: mocks.timeSignatureMapStoreValue.value,
        });
    });

    it('does not restore stores whose top-level snapshot fields are absent', () => {
        const tracks = { tracks: [], selectedTrackId: null };

        expect(restoreSnapshot(snapshot({ tracks }))).toBe(true);

        expect(mocks.restoreTrackSnapshot).toHaveBeenCalledWith(tracks);
        expect(mocks.restoreArrangementMetadataSnapshot).not.toHaveBeenCalled();
        expect(mocks.restoreTransportSnapshot).not.toHaveBeenCalled();
        expect(mocks.setMidiStoreState).not.toHaveBeenCalled();
        expect(mocks.restoreAutomationSnapshot).not.toHaveBeenCalled();
        expect(mocks.restoreTimelineMapSnapshot).not.toHaveBeenCalled();
    });

    it('restores a legacy payload without timeline slots while holding the live take-lane state', () => {
        const payload = {
            tracks: { tracks: [], selectedTrackId: null },
            markers: { markers: [], sections: [] },
            transport: { tempo: 132 },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            automation: { lanes: [] },
        };
        const liveLanes = { lanes: [{ id: 'lane-1', trackId: 'track-1', takes: [], activeCompRegions: [] }] };
        mocks.takeLaneStoreValue.value = liveLanes;

        expect(restoreSnapshot(snapshot(payload))).toBe(true);

        // No tempo-map write: the legacy snapshot never carried one, so the
        // live map stands.
        expect(mocks.restoreTimelineMapSnapshot).not.toHaveBeenCalled();
        // The metadata route still restores the captured markers while the
        // absent takeLanes section holds its live state.
        expect(mocks.restoreArrangementMetadataSnapshot).toHaveBeenCalledWith({
            markers: payload.markers,
            takeLanes: liveLanes,
        });
    });

    it('restores a tempo-map-only payload while holding the live time-signature map', () => {
        const payload = { tempoMap: { changes: [] } };
        const liveTimeSignatures = { changes: [{ id: 'ts-1', beat: 0, numerator: 7, denominator: 8 }] };
        mocks.timeSignatureMapStoreValue.value = liveTimeSignatures;

        expect(restoreSnapshot(snapshot(payload))).toBe(true);

        expect(mocks.restoreTimelineMapSnapshot).toHaveBeenCalledWith({
            tempoMap: payload.tempoMap,
            timeSignatureMap: liveTimeSignatures,
        });
        expect(mocks.restoreTrackSnapshot).not.toHaveBeenCalled();
    });

    it('should log when snapshot JSON is corrupt', () => {
        expect(restoreSnapshot(snapshot('{not json'))).toBe(false);

        expect(mocks.logger.error).toHaveBeenCalledWith(expect.any(Error));
    });

    it.each([
        { label: 'ownerless snapshot', value: { data: '{}', size: 2 } },
        { label: 'foreign snapshot', value: snapshot({}, 'bbbbbbbb-bbbb-8bbb-8bbb-bbbbbbbbbbbb') },
        { label: 'empty payload', value: snapshot('') },
        { label: 'object with no restorable fields', value: snapshot({ timestamp: 1 }) },
    ])('refuses an $label before any owning write', ({ value }) => {
        expect(restoreSnapshot(value)).toBe(false);

        expect(mocks.restoreTrackSnapshot).not.toHaveBeenCalled();
        expect(mocks.restoreArrangementMetadataSnapshot).not.toHaveBeenCalled();
        expect(mocks.restoreTransportSnapshot).not.toHaveBeenCalled();
        expect(mocks.setMidiStoreState).not.toHaveBeenCalled();
        expect(mocks.restoreAutomationSnapshot).not.toHaveBeenCalled();
        expect(mocks.restoreTimelineMapSnapshot).not.toHaveBeenCalled();
    });

    it.each([
        { label: 'uninitialized', project: { initialized: false, loading: false } },
        { label: 'loading', project: { initialized: true, loading: true } },
    ])('refuses restore while the active project is $label', ({ project }) => {
        mocks.project.value = project;
        mocks.settledProjectId.value = undefined;

        expect(restoreSnapshot(snapshot({ tracks: { tracks: [] } }))).toBe(false);
        expect(mocks.restoreTrackSnapshot).not.toHaveBeenCalled();
    });

    it('propagates an owning write failure instead of reporting refusal or success', () => {
        const failure = new Error('track restore failed');
        mocks.restoreTrackSnapshot.mockImplementationOnce(() => {
            throw failure;
        });

        expect(() => restoreSnapshot(snapshot({ tracks: { tracks: [] } }))).toThrow(failure);
    });
});
