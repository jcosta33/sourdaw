import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { midiStore } from '#/modules/MIDI/stores';

import { type ArrangementSnapshot } from '../../../stores/arrangementStore';
import { loadSnapshot } from '../loadSnapshot';

type SnapshotTrack = ArrangementSnapshot['tracks']['tracks'][number];

const mocks = vi.hoisted(() => {
    return {
        restore_arrangement_metadata_snapshot: vi.fn<(input: { markers?: unknown; takeLanes?: unknown }) => void>(),
        restore_timeline_map_snapshot: vi.fn<(input: { tempoMap?: unknown; timeSignatureMap?: unknown }) => void>(),
        restore_automation_snapshot: vi.fn<(snapshot: unknown) => void>(),
        restore_track_snapshot: vi.fn<(snapshot: unknown) => void>(),
        set_midi_store_state: vi.fn<(state: unknown) => void>(),
    };
});

vi.mock('#/modules/Arrangement/useCases', () => ({
    restoreArrangementMetadataSnapshot: mocks.restore_arrangement_metadata_snapshot,
    restoreTrackSnapshot: mocks.restore_track_snapshot,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    restoreAutomationSnapshot: mocks.restore_automation_snapshot,
    getAutomationLaneCeiling: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/useCases')>();
    return {
        ...actual,
        setMidiStoreState: (state: unknown): void => {
            mocks.set_midi_store_state(state);
            actual.setMidiStoreState(state);
        },
    };
});

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
        configureAutomergeStoragePort(null);
        flushAutomergeStorageWrites();
        midiStore.set({
            probabilitySeed: 0xdecafbad,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        flushAutomergeStorageWrites();
        vi.clearAllMocks();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
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

    it('delegates omitted timeline maps and Arrangement metadata', () => {
        // A snapshot captured from an arrangement that had no tempo map, markers,
        // or take lanes. The Arrangement-owned restore must clear its stale stores.
        loadSnapshot(baseSnapshot);

        expect(mocks.restore_timeline_map_snapshot).toHaveBeenCalledTimes(1);
        expect(mocks.restore_timeline_map_snapshot).toHaveBeenCalledWith({
            tempoMap: undefined,
            timeSignatureMap: undefined,
        });
        expect(mocks.restore_arrangement_metadata_snapshot).toHaveBeenCalledTimes(1);
        expect(mocks.restore_arrangement_metadata_snapshot).toHaveBeenCalledWith({
            markers: undefined,
            takeLanes: undefined,
        });
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
        expect(mocks.restore_arrangement_metadata_snapshot).toHaveBeenCalledTimes(1);
        expect(mocks.restore_arrangement_metadata_snapshot).toHaveBeenCalledWith({
            markers: snapshot.markers,
            takeLanes: snapshot.takeLanes,
        });
        expect(mocks.restore_track_snapshot).toHaveBeenCalledWith(snapshot.tracks);
        expect(mocks.restore_automation_snapshot).toHaveBeenCalledWith(snapshot.automation);
        expect(mocks.set_midi_store_state).toHaveBeenCalledWith(snapshot.midi);
    });

    it('preserves the active project seed when loading legacy and current arrangement MIDI', () => {
        const legacyMidi = {
            probabilitySeed: 123,
            notesByClipId: { legacy: [] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        const legacySnapshot: ArrangementSnapshot = { ...baseSnapshot, midi: legacyMidi };
        const currentSnapshot: ArrangementSnapshot = {
            ...baseSnapshot,
            midi: { notesByClipId: { current: [] }, ccByClipId: {}, pitchBendByClipId: {} },
        };

        loadSnapshot(legacySnapshot);
        expect(midiStore.value).toEqual({
            probabilitySeed: 0xdecafbad,
            notesByClipId: { legacy: [] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        loadSnapshot(currentSnapshot);
        expect(midiStore.value).toEqual({
            probabilitySeed: 0xdecafbad,
            notesByClipId: { current: [] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        expect(mocks.set_midi_store_state).toHaveBeenLastCalledWith(currentSnapshot.midi);
    });
});
