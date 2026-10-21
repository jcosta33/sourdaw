import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { slipClipContent } from '#/modules/Arrangement/useCases/clipEditing/slipClipContent';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip } from '#/modules/MIDI/useCases';
import { selectMidiNotesForLoopWindow } from '#/modules/Transport/useCases';

import { handleSlipClipContent } from '../../../handlers/clip/handleSlipClipContent';
import { createTrack } from '../../../models/Track';

/**
 * A looped MIDI clip stores its content offset's phase inside
 * `[0, loopLength)`; the scheduler, groove projection, offline projection and
 * controller windows all read the rows at `note.startBeat -
 * midiOffsetBeats` against the anchored loop window
 * `[-advance, loopLength - advance)`. A slip moves the offset without touching
 * `startBeat` or the anchor — the window floor is slip-invariant — so the
 * stored state after a slip must keep every row's relative inside that
 * unmoved window, or the clip plays total silence.
 */

function loopedClip(id: string): Clip {
    return {
        id,
        trackId: 't-keys',
        name: id,
        startBeat: 0,
        endBeat: 16,
        type: 'midi',
        audioOffsetBeats: 0,
        midiOffsetBeats: 0,
        loopEnabled: true,
        loopLength: 4,
        loopOriginBeat: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function unloopedClip(id: string): Clip {
    return { ...loopedClip(id), loopEnabled: undefined, loopLength: undefined, loopOriginBeat: undefined };
}

function seed(clips: Clip[]): void {
    const keys = createTrack({ id: 't-keys', name: 'Keys', kind: 'midi', withoutDefaultDevice: true });
    trackStore.set({ ...defaultTrackState, tracks: [{ ...keys, clips }] });
    const rowClipId = clips[0]!.id;
    midiStore.set({
        ...defaultMidiStoreState,
        notesByClipId: {
            [rowClipId]: [0, 1, 2, 3].map((startBeat, index) => ({
                id: `n-${index}`,
                pitch: 60 + index,
                startBeat,
                duration: 0.25,
                velocity: 100,
            })),
        },
        ccByClipId: {
            [rowClipId]: [{ id: 'cc-64', controller: 64, value: 127, beat: 0, channel: 0 }],
        },
    });
}

function readClip(clipId: string): Clip {
    const found = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!found) {
        throw new Error(`Expected clip ${clipId} in the track store`);
    }
    return found;
}

function storedNoteBeats(clipId: string): number[] {
    return getNotesForClip(clipId).map((note) => note.startBeat);
}

function storedPressBeats(clipId: string): number[] {
    return (midiStore.value?.ccByClipId[clipId] ?? []).map((row) => row.beat);
}

/** The scheduling selector on the clip's stored figures — the admission law the audience hears. */
function audibleStoredNotes(clip: Clip): number {
    return selectMidiNotesForLoopWindow({
        notes: getNotesForClip(clip.id),
        iterationStartBeat: 0,
        loopLengthBeats: 4,
        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
        fromBeat: 0,
        toBeat: 4,
        lastScheduledBeat: 0,
        grooveLookaroundBeats: 0,
        clipStartBeat: clip.startBeat,
        loopOriginBeat: clip.loopOriginBeat,
        loopEnabled: clip.loopEnabled === true,
    }).length;
}

describe('slipClipContent keeps a looped MIDI clip inside its loop', () => {
    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set(structuredClone(defaultMidiStoreState));
    });

    it('a slip across one whole loop wraps the offset and keeps every row audible', () => {
        // The wholesale write parked midiOffsetBeats at the raw figure 4 — one
        // loop past the region — and the anchored window read every stored row
        // a whole loop below its floor: four rows audible at offset 0, none at
        // 4, the clip playing total silence. The wrap stores the phase instead,
        // and the rows stay put: the untouched rows are the only placement
        // whose relatives read inside the window the slip never moved.
        seed([loopedClip('c-loop')]);

        expect(slipClipContent('c-loop', 'midi', 4)).toBe(true);

        const slipped = readClip('c-loop');
        expect(slipped.midiOffsetBeats).toBe(0);
        expect(storedNoteBeats('c-loop')).toEqual([0, 1, 2, 3]);
        expect(storedPressBeats('c-loop')).toEqual([0]);
        expect(audibleStoredNotes(slipped)).toBe(4);
    });

    it('a negative slip that wraps up to its phase rides the stored rows by the same lift', () => {
        // Wrapping -1 to its phase 3 raises the stored figure by 4; the rows
        // ride the same lift so `note.startBeat - midiOffsetBeats` keeps the
        // exact figures the wrap-less write produced (rows 4..7 against offset
        // 3 read as rows 0..3 against -1). This is the only window-safe row
        // shift a slip can carry: the raise re-bases the rows inside the same
        // unmoved window instead of parking them a loop below it.
        seed([loopedClip('c-loop')]);

        expect(slipClipContent('c-loop', 'midi', -1)).toBe(true);

        const slipped = readClip('c-loop');
        expect(slipped.midiOffsetBeats).toBe(3);
        expect(storedNoteBeats('c-loop')).toEqual([4, 5, 6, 7]);
        expect(storedPressBeats('c-loop')).toEqual([4]);
        // The relatives are unmoved — including the ceiling row past the
        // region end's relative, which the wrap-less write dropped the same
        // way (a straddling slide needs a per-row wrap, not a uniform shift).
        expect(audibleStoredNotes(slipped)).toBe(3);
    });

    it('control: a sub-loop slip keeps the wholesale offset and unmoved rows', () => {
        seed([loopedClip('c-loop')]);

        expect(slipClipContent('c-loop', 'midi', 1)).toBe(true);

        const slipped = readClip('c-loop');
        expect(slipped.midiOffsetBeats).toBe(1);
        expect(storedNoteBeats('c-loop')).toEqual([0, 1, 2, 3]);
        expect(storedPressBeats('c-loop')).toEqual([0]);
    });

    it('control: a loop-off clip stores the raw offset wholesale', () => {
        seed([unloopedClip('c-plain')]);

        expect(slipClipContent('c-plain', 'midi', 7)).toBe(true);

        expect(readClip('c-plain').midiOffsetBeats).toBe(7);
        expect(storedNoteBeats('c-plain')).toEqual([0, 1, 2, 3]);
    });
});

describe('a slip undo restores the rows its raising wrap lifted (#5198)', () => {
    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set(structuredClone(defaultMidiStoreState));
    });

    /** Slips through the real handler and replays the inverse it recorded. */
    function slipAndUndo(offset: number): void {
        const action = { type: 'slipClipContent', payload: { clipId: 'c-loop', clipType: 'midi', offset } } as const;
        const description = handleSlipClipContent.describe(action);
        expect(handleSlipClipContent.execute(action)).toEqual({ status: 'written' });
        if (description.inverseAction?.type !== 'slipClipContent') {
            throw new Error('Expected slip inverse action');
        }
        // The recorded inverse carries the un-lift of the lift the forward
        // slip just applied — the rows it must restore to their pre-slip
        // figures.
        expect(description.inverseAction.payload.offset).toBe(0);
        expect(description.inverseAction.payload.rowLiftBeats).toBeLessThan(0);
        expect(handleSlipClipContent.execute(description.inverseAction)).toEqual({ status: 'written' });
    }

    function expectPreSlipStateRestored(): void {
        const restored = readClip('c-loop');
        expect(restored.midiOffsetBeats).toBe(0);
        expect(storedNoteBeats('c-loop')).toEqual([0, 1, 2, 3]);
        expect(storedPressBeats('c-loop')).toEqual([0]);
        expect(audibleStoredNotes(restored)).toBe(4);
    }

    it('restores rows and audibility byte-exact after a whole-loop negative slip', () => {
        // The -4 slip raises to its phase 0 and lifts the rows a whole loop to
        // [4,5,6,7]; an offset-only inverse leaves them parked above the
        // unmoved window — every row dropped, the undo playing silence where
        // the pre-slip clip played four notes.
        seed([loopedClip('c-loop')]);

        slipAndUndo(-4);

        expectPreSlipStateRestored();
    });

    it('restores rows and audibility byte-exact after a sub-loop negative slip', () => {
        // The -1 slip raises to its phase 3 and lifts the rows to [4,5,6,7];
        // the forward keeps 3 of them audible, and the undo must put all four
        // back, not leave the lifted figures against the restored offset 0.
        seed([loopedClip('c-loop')]);

        slipAndUndo(-1);

        expectPreSlipStateRestored();
    });

    it('control: a keyless legacy slip inverse moves no rows, as the pre-anchor replay never did', () => {
        // Entries recorded before the lift field existed decode without it. A
        // pre-anchor slip never shifted rows, so its inverse must not either:
        // the keyless replay restores the offset and leaves the stored figures
        // exactly where the forward left them — no lift restoration is
        // invented for a payload that never carried one.
        seed([loopedClip('c-loop')]);
        expect(slipClipContent('c-loop', 'midi', -1)).toBe(true);
        expect(storedNoteBeats('c-loop')).toEqual([4, 5, 6, 7]);

        const keylessLegacyInverse = {
            type: 'slipClipContent',
            payload: { clipId: 'c-loop', clipType: 'midi', offset: 0 },
        } as const;
        expect(handleSlipClipContent.execute(keylessLegacyInverse)).toEqual({ status: 'written' });

        expect(readClip('c-loop').midiOffsetBeats).toBe(0);
        expect(storedNoteBeats('c-loop')).toEqual([4, 5, 6, 7]);
        expect(storedPressBeats('c-loop')).toEqual([4]);
    });
});
