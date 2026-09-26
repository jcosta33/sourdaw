import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';

import { midiStore } from '../../../stores/midiStore';
import { setMidiStoreState } from '../../setMidiStoreState';
import { migrateAbsoluteMidiNotes } from '../migrateAbsoluteMidiNotes';

const TRACK_ID = 'track-drums';
const CLIP_ID = 'clip-drums';

function placeMidiClip(name: string, startBeat: number, endBeat = startBeat + 8): void {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [createTrack({ id: TRACK_ID, kind: 'midi', name: 'Drums' })],
    });
    const clip = addClip({ id: CLIP_ID, trackId: TRACK_ID, startBeat, endBeat, name, type: 'midi' });
    if (clip === null) {
        throw new Error('Expected MIDI clip fixture');
    }
}

function setClipNotes(startBeats: readonly number[], noteCoordinateFormat?: 'clip-relative'): void {
    const state: Parameters<typeof midiStore.set>[0] = {
        notesByClipId: {
            [CLIP_ID]: startBeats.map((startBeat, index) => ({
                id: `note-${String(index)}`,
                pitch: 36,
                startBeat,
                duration: 0.5,
                velocity: 100,
                channel: 0,
            })),
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    };
    if (noteCoordinateFormat !== undefined) {
        state.noteCoordinateFormat = noteCoordinateFormat;
    }
    midiStore.set(state);
}

function clipNoteStarts(): number[] {
    return (midiStore.value?.notesByClipId[CLIP_ID] ?? []).map((note) => note.startBeat);
}

describe('migrateAbsoluteMidiNotes on project reload', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('leaves a current clip-relative clip whose first bar is silent where the musician put it', () => {
        // A two-bar drum clip at bar 2 whose pattern enters in its second bar:
        // clip-relative notes at 4 and 6, audible at beats 8 and 10.
        placeMidiClip('Drums', 4);
        setClipNotes([4, 6]);

        migrateAbsoluteMidiNotes();

        expect(clipNoteStarts()).toEqual([4, 6]);
    });

    it('leaves a duplicated clip alone, although duplication names it "(copy)"', () => {
        placeMidiClip('Bass (copy)', 2);
        setClipNotes([2, 3]);

        migrateAbsoluteMidiNotes();

        expect(clipNoteStarts()).toEqual([2, 3]);
    });

    it('keeps a legacy clip migrated once after an arrangement snapshot is restored', () => {
        // First boot migrates a legacy absolute clip to clip-relative [4, 6].
        placeMidiClip('Melody take 2', 4);
        setClipNotes([8, 10]);
        migrateAbsoluteMidiNotes();
        expect(clipNoteStarts()).toEqual([4, 6]);

        // Switching arrangements restores the MIDI snapshot the way
        // `loadSnapshot` does: notes, CC and pitch bend only.
        const migrated = midiStore.value!;
        setMidiStoreState({
            notesByClipId: migrated.notesByClipId,
            ccByClipId: migrated.ccByClipId,
            pitchBendByClipId: migrated.pitchBendByClipId,
        });

        // Next boot.
        migrateAbsoluteMidiNotes();

        expect(clipNoteStarts()).toEqual([4, 6]);
    });

    it('leaves a trimmed clip holding its retained notes, although the geometry alone reads them as legacy absolute', () => {
        // trimClipEnd shortens endBeat without pruning stored notes: a
        // two-beat clip at bar 2 retaining notes at beats 4 and 6. Without
        // the upper bound the geometric gate read those positions as legacy
        // absolute data and shifted them a clip length earlier on every load
        // (#4827).
        placeMidiClip('Drums', 4, 6);
        setClipNotes([4, 6]);

        migrateAbsoluteMidiNotes();

        expect(clipNoteStarts()).toEqual([4, 6]);
    });

    it('skips the pass outright for a store stamped with the current clip-relative format', () => {
        // Notes at 8 and 10 in a two-bar clip at bar 2 are a shape the
        // geometric gate alone would rewrite; the coordinate stamp, not the
        // geometry, is what keeps current-format data untouched.
        placeMidiClip('Drums', 4, 12);
        setClipNotes([8, 10], 'clip-relative');

        migrateAbsoluteMidiNotes();

        expect(clipNoteStarts()).toEqual([8, 10]);
    });
});
