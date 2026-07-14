import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ArrangementSnapshot } from '../../../stores/arrangementStore';
import { loadSnapshot } from '../loadSnapshot';

type SnapshotTrack = ArrangementSnapshot['tracks']['tracks'][number];

type SetStoreMock<TValue> = {
    set: (new_value: TValue) => void;
};

const mocks = vi.hoisted(() => {
    function create_set_store_mock<TValue>(): SetStoreMock<TValue> {
        return { set: vi.fn<(new_value: TValue) => void>() };
    }

    return {
        marker_store: create_set_store_mock<NonNullable<ArrangementSnapshot['markers']>>(),
        midi_store: create_set_store_mock<ArrangementSnapshot['midi']>(),
        restore_automation_snapshot: vi.fn<(snapshot: unknown) => void>(),
        restore_track_snapshot: vi.fn<(snapshot: unknown) => void>(),
        take_lane_store: create_set_store_mock<NonNullable<ArrangementSnapshot['takeLanes']>>(),
        tempo_map_store: create_set_store_mock<NonNullable<ArrangementSnapshot['tempoMap']>>(),
        time_signature_map_store: create_set_store_mock<NonNullable<ArrangementSnapshot['timeSignatureMap']>>(),
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: mocks.marker_store,
    takeLaneStore: mocks.take_lane_store,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    restoreTrackSnapshot: mocks.restore_track_snapshot,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    restoreAutomationSnapshot: mocks.restore_automation_snapshot,
}));

vi.mock('#/modules/MIDI/stores', () => ({ midiStore: mocks.midi_store }));

vi.mock('#/modules/Transport/stores', () => ({
    tempoMapStore: mocks.tempo_map_store,
    timeSignatureMapStore: mocks.time_signature_map_store,
}));

function create_track(overrides: Partial<SnapshotTrack> = {}): SnapshotTrack {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'main',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

const baseSnapshot: ArrangementSnapshot = {
    id: 'a1',
    name: 'Arrangement 1',
    tracks: { tracks: [], selectedTrackId: null },
    automation: { lanes: [] },
    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
};

describe('loadSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates track and Automation restoration to their owning modules', () => {
        const raw_track = create_track({ id: 'raw-track', name: 'Raw Track' });
        const snapshot: ArrangementSnapshot = {
            ...baseSnapshot,
            tracks: { tracks: [raw_track], selectedTrackId: 'raw-track' },
            automation: { lanes: [] },
            midi: { notesByClipId: { 'clip-1': [] }, ccByClipId: {}, pitchBendByClipId: {} },
        };

        loadSnapshot(snapshot);

        expect(mocks.restore_track_snapshot).toHaveBeenCalledWith(snapshot.tracks);
        expect(mocks.restore_automation_snapshot).toHaveBeenCalledWith(snapshot.automation);
        expect(mocks.midi_store.set).toHaveBeenCalledWith(snapshot.midi);
    });

    it('should clear the shared tempo/timeSig/marker/takeLane stores when the snapshot omits those fields', () => {
        // A snapshot captured from an arrangement that had no tempo map, markers,
        // or take lanes. Switching to it must not leave the previous arrangement's
        // values installed in the shared stores.
        loadSnapshot(baseSnapshot);

        expect(mocks.tempo_map_store.set).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.time_signature_map_store.set).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.marker_store.set).toHaveBeenCalledWith({ markers: [], sections: [] });
        expect(mocks.take_lane_store.set).toHaveBeenCalledWith({ lanes: [] });
    });

    it('should write the snapshot values when present', () => {
        const snapshot: ArrangementSnapshot = {
            ...baseSnapshot,
            tempoMap: { changes: [{ id: 't1', beat: 0, tempo: 140, curve: 'instant' }] },
            timeSignatureMap: { changes: [{ id: 's1', beat: 0, numerator: 3, denominator: 4 }] },
            markers: { markers: [{ id: 'm1', beat: 4, name: 'Verse', color: '#fff' }], sections: [] },
            takeLanes: { lanes: [] },
        };

        loadSnapshot(snapshot);

        expect(mocks.tempo_map_store.set).toHaveBeenCalledWith(snapshot.tempoMap);
        expect(mocks.time_signature_map_store.set).toHaveBeenCalledWith(snapshot.timeSignatureMap);
        expect(mocks.marker_store.set).toHaveBeenCalledWith(snapshot.markers);
        expect(mocks.take_lane_store.set).toHaveBeenCalledWith(snapshot.takeLanes);
        expect(mocks.restore_track_snapshot).toHaveBeenCalledWith(snapshot.tracks);
        expect(mocks.restore_automation_snapshot).toHaveBeenCalledWith(snapshot.automation);
        expect(mocks.midi_store.set).toHaveBeenCalledWith(snapshot.midi);
    });
});
