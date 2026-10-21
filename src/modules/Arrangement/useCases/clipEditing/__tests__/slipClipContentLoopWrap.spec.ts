import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { slipClipContent } from '#/modules/Arrangement/useCases/clipEditing/slipClipContent';
import { normalizeLegacyLoopAnchorInverse } from '#/modules/Command/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip } from '#/modules/MIDI/useCases';
import { selectMidiNotesForLoopWindow } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

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

/** The undo seams' replay at unit scale: the legacy normalization, then the dispatch. */
function executeThroughUndoSeam(action: AppAction) {
    const normalized = normalizeLegacyLoopAnchorInverse(action);
    if (normalized.type !== 'slipClipContent') {
        throw new Error('Expected slipClipContent action from the undo seam');
    }
    return handleSlipClipContent.execute(normalized);
}

/** The scheduling selector on the clip's stored figures — the admission law the audience hears. */
function audibleStoredNotes(clip: Clip): number {
    const loopLengthBeats = clip.loopLength ?? 4;
    return selectMidiNotesForLoopWindow({
        notes: getNotesForClip(clip.id),
        iterationStartBeat: 0,
        loopLengthBeats,
        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
        fromBeat: 0,
        toBeat: loopLengthBeats,
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

    it('control: a keyless legacy slip inverse restores verbatim through the undo seam — no wrap, no row movement', () => {
        // Entries recorded before the lift field existed decode without it.
        // The pre-anchor slip undo restored the captured offset verbatim and
        // moved no rows — the forward wrap law did not exist yet — and the
        // undo seam keys the legacy payload to that same restoration
        // (`rowLiftBeats: 0`, zero included). Never the fresh wrap law: a
        // wrap here would re-wrap the captured figure, and never an invented
        // un-lift for a payload that never carried one.
        seed([loopedClip('c-loop')]);
        expect(slipClipContent('c-loop', 'midi', -1)).toBe(true);
        expect(storedNoteBeats('c-loop')).toEqual([4, 5, 6, 7]);

        const keylessLegacyInverse = {
            type: 'slipClipContent',
            payload: { clipId: 'c-loop', clipType: 'midi', offset: 0 },
        } as const;
        expect(executeThroughUndoSeam(keylessLegacyInverse)).toEqual({ status: 'written' });

        expect(readClip('c-loop').midiOffsetBeats).toBe(0);
        expect(storedNoteBeats('c-loop')).toEqual([4, 5, 6, 7]);
        expect(storedPressBeats('c-loop')).toEqual([4]);
    });
});

describe('a slip undo restores the captured offset verbatim, not its phase at replay time', () => {
    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set(structuredClone(defaultMidiStoreState));
    });

    it('restores a legacy raw negative offset to the captured audible state', () => {
        // A pre-anchor slip stored the raw figure −1, and hydrate passes it
        // verbatim. The captured state sounds 3 of 4 rows through the anchored
        // window. Re-wrapping the captured −1 to its phase 3 at replay time
        // wrote offset 3 against the rows the recorded shift restored to
        // 0..3 — relatives −3..0 against the unmoved window, 1 of 4 audible,
        // a state the pre-action clip never carried.
        seed([{ ...loopedClip('c-loop'), midiOffsetBeats: -1 }]);

        const action = {
            type: 'slipClipContent',
            payload: { clipId: 'c-loop', clipType: 'midi', offset: -4 },
        } as const;
        const description = handleSlipClipContent.describe(action);
        expect(handleSlipClipContent.execute(action)).toEqual({ status: 'written' });
        if (description.inverseAction?.type !== 'slipClipContent') {
            throw new Error('Expected slip inverse action');
        }
        expect(description.inverseAction.payload.offset).toBe(-1);
        expect(handleSlipClipContent.execute(description.inverseAction)).toEqual({ status: 'written' });

        const restored = readClip('c-loop');
        expect(restored.midiOffsetBeats).toBe(-1);
        expect(storedNoteBeats('c-loop')).toEqual([0, 1, 2, 3]);
        expect(audibleStoredNotes(restored)).toBe(3);
    });

    it('restores a stored phase a loop-length change de-phased, instead of re-writing the slipped state', () => {
        // setClipLoopLength re-wraps nothing: offset 3 under a loop shrunk to
        // 2 is a stale phase. The −1 slip lifts the rows to 2..5 and stores
        // phase 1; replaying the captured 3 through the wrap law produced
        // phase 1 again — the exact post-slip offset, an undo that consumed
        // the entry and lost the pre-slip state.
        seed([{ ...loopedClip('c-loop'), loopLength: 2, midiOffsetBeats: 3 }]);

        const action = {
            type: 'slipClipContent',
            payload: { clipId: 'c-loop', clipType: 'midi', offset: -1 },
        } as const;
        const description = handleSlipClipContent.describe(action);
        expect(handleSlipClipContent.execute(action)).toEqual({ status: 'written' });
        if (description.inverseAction?.type !== 'slipClipContent') {
            throw new Error('Expected slip inverse action');
        }
        expect(description.inverseAction.payload.offset).toBe(3);
        expect(handleSlipClipContent.execute(description.inverseAction)).toEqual({ status: 'written' });

        const restored = readClip('c-loop');
        expect(restored.midiOffsetBeats).toBe(3);
        expect(storedNoteBeats('c-loop')).toEqual([0, 1, 2, 3]);
        expect(audibleStoredNotes(restored)).toBe(1);
    });

    it('records the zero-lift inverse so an undo restores a de-phased captured offset verbatim', () => {
        // The zero-lift slip is where keying the inverse on a NON-ZERO lift
        // broke: offset 3 under a loop shrunk to 2 is a stale phase, and the
        // slip to 5 wraps DOWN to phase 1 — no row ride, so the capture keyed
        // only on a non-zero lift recorded a keyless inverse. The keyless
        // replay then took the fresh wrap law: the captured 3 re-wrapped to
        // phase 1, byte-identical to the post-slip state, the entry consumed
        // with the pre-slip state lost. The capture records the key always —
        // zero included — because the replay keys the restoration on the
        // key's PRESENCE, so the undo restores the captured 3 and the single
        // audible row it carried.
        seed([{ ...loopedClip('c-loop'), loopLength: 2, midiOffsetBeats: 3 }]);

        const action = {
            type: 'slipClipContent',
            payload: { clipId: 'c-loop', clipType: 'midi', offset: 5 },
        } as const;
        const description = handleSlipClipContent.describe(action);
        expect(handleSlipClipContent.execute(action)).toEqual({ status: 'written' });
        expect(readClip('c-loop').midiOffsetBeats).toBe(1);
        if (description.inverseAction?.type !== 'slipClipContent') {
            throw new Error('Expected slip inverse action');
        }
        expect(description.inverseAction.payload.offset).toBe(3);
        expect(description.inverseAction.payload.rowLiftBeats).toBe(0);
        expect(handleSlipClipContent.execute(description.inverseAction)).toEqual({ status: 'written' });

        const restored = readClip('c-loop');
        expect(restored.midiOffsetBeats).toBe(3);
        expect(storedNoteBeats('c-loop')).toEqual([0, 1, 2, 3]);
        expect(storedPressBeats('c-loop')).toEqual([0]);
        expect(audibleStoredNotes(restored)).toBe(1);
    });

    it('restores a keyless legacy raw offset through the undo seam verbatim, moving no rows', () => {
        // A pre-field build recorded offset-only slip inverses, and its
        // pre-PR undo restored the captured raw figure verbatim — no wrap law
        // existed. Replayed keyless, the handler cannot tell the inverse from
        // a fresh slip: the captured −1 re-wraps to its phase 3 AND the
        // raising wrap shifts every row +4, a state the pre-action clip never
        // carried. The undo seam keys the legacy payload to the same
        // restoration the field now always records, so the −1 comes back
        // exactly as captured with the rows unmoved — 3 of 4 audible through
        // the anchored window, as before the slip.
        seed([{ ...loopedClip('c-loop'), midiOffsetBeats: -1 }]);

        const keylessLegacyInverse = {
            type: 'slipClipContent',
            payload: { clipId: 'c-loop', clipType: 'midi', offset: -1 },
        } as const;
        expect(executeThroughUndoSeam(keylessLegacyInverse)).toEqual({ status: 'written' });

        const restored = readClip('c-loop');
        expect(restored.midiOffsetBeats).toBe(-1);
        expect(storedNoteBeats('c-loop')).toEqual([0, 1, 2, 3]);
        expect(storedPressBeats('c-loop')).toEqual([0]);
        expect(audibleStoredNotes(restored)).toBe(3);
    });
});
