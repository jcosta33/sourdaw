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
        restore_timeline_map_snapshot: vi.fn<(input: { tempoMap?: unknown; timeSignatureMap?: unknown }) => void>(),
        restore_automation_snapshot: vi.fn<(snapshot: unknown) => void>(),
        restore_track_snapshot: vi.fn<(snapshot: unknown) => void>(),
        set_midi_store_state: vi.fn<(state: unknown) => void>(),
        take_lane_store: create_set_store_mock<NonNullable<ArrangementSnapshot['takeLanes']>>(),
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

vi.mock('#/modules/MIDI/useCases', () => ({ setMidiStoreState: mocks.set_midi_store_state }));

vi.mock('#/modules/Transport/useCases', () => ({
    restoreTimelineMapSnapshot: mocks.restore_timeline_map_snapshot,
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
        expect(mocks.set_midi_store_state).toHaveBeenCalledWith(snapshot.midi);
    });

    it('delegates omitted timeline maps and clears the remaining shared stores', () => {
        // A snapshot captured from an arrangement that had no tempo map, markers,
        // or take lanes. Switching to it must not leave the previous arrangement's
        // values installed in the shared stores.
        loadSnapshot(baseSnapshot);

        expect(mocks.restore_timeline_map_snapshot).toHaveBeenCalledTimes(1);
        expect(mocks.restore_timeline_map_snapshot).toHaveBeenCalledWith({
            tempoMap: undefined,
            timeSignatureMap: undefined,
        });
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

        expect(mocks.restore_timeline_map_snapshot).toHaveBeenCalledTimes(1);
        expect(mocks.restore_timeline_map_snapshot).toHaveBeenCalledWith({
            tempoMap: snapshot.tempoMap,
            timeSignatureMap: snapshot.timeSignatureMap,
        });
        expect(mocks.marker_store.set).toHaveBeenCalledWith(snapshot.markers);
        expect(mocks.take_lane_store.set).toHaveBeenCalledWith(snapshot.takeLanes);
        expect(mocks.restore_track_snapshot).toHaveBeenCalledWith(snapshot.tracks);
        expect(mocks.restore_automation_snapshot).toHaveBeenCalledWith(snapshot.automation);
        expect(mocks.set_midi_store_state).toHaveBeenCalledWith(snapshot.midi);
    });
});
