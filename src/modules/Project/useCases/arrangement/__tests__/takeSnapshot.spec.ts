import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreState } from '#/modules/MIDI/stores';

import { type ArrangementSnapshot } from '../../../stores/arrangementStore';
import { takeSnapshot } from '../takeSnapshot';

/** The live track store value, which also carries transient view state. */
type TracksStoreValue = ArrangementSnapshot['tracks'] & { ghostClips?: unknown[] };

type StoreMock<TValue> = {
    value: TValue | null;
};

const mocks = vi.hoisted(() => {
    function create_store_mock<TValue>(value: TValue | null): StoreMock<TValue> {
        return { value };
    }

    return {
        automation_store: create_store_mock<ArrangementSnapshot['automation']>(null),
        marker_store: create_store_mock<NonNullable<ArrangementSnapshot['markers']>>(null),
        midi_store: create_store_mock<MidiStoreState>(null),
        take_lane_store: create_store_mock<NonNullable<ArrangementSnapshot['takeLanes']>>(null),
        tempo_map_store: create_store_mock<NonNullable<ArrangementSnapshot['tempoMap']>>(null),
        time_signature_map_store: create_store_mock<NonNullable<ArrangementSnapshot['timeSignatureMap']>>(null),
        track_store: create_store_mock<TracksStoreValue>(null),
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: mocks.marker_store,
    takeLaneStore: mocks.take_lane_store,
    trackStore: mocks.track_store,
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: mocks.automation_store,
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: mocks.midi_store,
}));

vi.mock('#/modules/Transport/stores', () => ({
    tempoMapStore: mocks.tempo_map_store,
    timeSignatureMapStore: mocks.time_signature_map_store,
}));

function reset_store_values(): void {
    mocks.automation_store.value = null;
    mocks.marker_store.value = null;
    mocks.midi_store.value = null;
    mocks.take_lane_store.value = null;
    mocks.tempo_map_store.value = null;
    mocks.time_signature_map_store.value = null;
    mocks.track_store.value = null;
}

describe('takeSnapshot', () => {
    beforeEach(() => {
        reset_store_values();
    });

    it('should capture empty fallback snapshot shapes when stores are uninitialized', () => {
        expect(takeSnapshot('arr-empty', 'Empty')).toEqual({
            id: 'arr-empty',
            name: 'Empty',
            tracks: { tracks: [], selectedTrackId: null },
            automation: { lanes: [] },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            tempoMap: undefined,
            timeSignatureMap: undefined,
            markers: undefined,
            takeLanes: undefined,
        });
    });

    it('should capture present Arrangement Automation MIDI and Transport snapshot values', () => {
        const tracks: ArrangementSnapshot['tracks'] = { tracks: [], selectedTrackId: 'track-1' };
        const automation: ArrangementSnapshot['automation'] = { lanes: [] };
        const midi: MidiStoreState = {
            probabilitySeed: 0xdecafbad,
            notesByClipId: { 'clip-1': [] },
            ccByClipId: { 'clip-1': [] },
            pitchBendByClipId: { 'clip-1': [] },
        };
        const tempoMap: NonNullable<ArrangementSnapshot['tempoMap']> = {
            changes: [{ id: 'tempo-1', beat: 0, tempo: 140, curve: 'instant' }],
        };
        const timeSignatureMap: NonNullable<ArrangementSnapshot['timeSignatureMap']> = {
            changes: [{ id: 'sig-1', beat: 0, numerator: 3, denominator: 4 }],
        };
        const markers: NonNullable<ArrangementSnapshot['markers']> = {
            markers: [{ id: 'marker-1', beat: 4, name: 'Verse', color: '#ffffff' }],
            sections: [],
        };
        const takeLanes: NonNullable<ArrangementSnapshot['takeLanes']> = { lanes: [] };
        mocks.track_store.value = tracks;
        mocks.automation_store.value = automation;
        mocks.midi_store.value = midi;
        mocks.tempo_map_store.value = tempoMap;
        mocks.time_signature_map_store.value = timeSignatureMap;
        mocks.marker_store.value = markers;
        mocks.take_lane_store.value = takeLanes;

        const snapshot = takeSnapshot('arr-live', 'Live');

        expect(snapshot).toEqual({
            id: 'arr-live',
            name: 'Live',
            tracks,
            automation,
            midi: {
                notesByClipId: midi.notesByClipId,
                ccByClipId: midi.ccByClipId,
                pitchBendByClipId: midi.pitchBendByClipId,
            },
            tempoMap,
            timeSignatureMap,
            markers,
            takeLanes,
        });
        expect(snapshot.tracks).toEqual(tracks);
        expect(snapshot.automation).toBe(automation);
        expect(snapshot.midi).not.toHaveProperty('probabilitySeed');
    });

    it('should persist only the arrangement keys of the tracks section, never transient ghost clips', () => {
        // A snapshot key the hydrate projection rebuilds away is content the
        // raw projection-loss detector can never see returned: the document
        // reads as corrupt and the project refuses every edit and every save.
        mocks.track_store.value = {
            tracks: [],
            selectedTrackId: null,
            ghostClips: [{ id: 'ghost-1', trackId: 'track-1', startBeat: 0, duration: 4 }],
        };

        const snapshot = takeSnapshot('arr-ghosts', 'Ghosts');

        expect(Object.keys(snapshot.tracks).toSorted()).toEqual(['selectedTrackId', 'tracks']);
    });
});
