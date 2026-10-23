import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip } from '#/modules/MIDI/useCases';
import { selectMidiNotesForLoopWindow } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { handleSlipClipContent } from '../../../handlers/clip/handleSlipClipContent';
import { handleTrimClipStart } from '../../../handlers/clip/handleTrimClipStart';
import { createTrack } from '../../../models/Track';

/**
 * #5512 — a slip whose undo rides the trim undo on a duration-derived loop.
 *
 * `trimClipStart` wraps the trim's advance against the loop length the clip
 * plays AFTER the trim, while its recorded inverse replays the restore through
 * the same wrap against the length the clip plays AFTER the restore. With a
 * configured `loopLength` the two bases are the same constant and the pair
 * composes algebraically exactly. With `loopLength` undefined the effective
 * length is the clip's own duration — which a start trim changes — so the
 * forward wrap and its replay wrap disagree by construction and the recorded
 * restoration lands a trim-wrap distance away from the figures the slip's
 * inverse then restores against. The stored rows end up displaced and the
 * reader-visible admission with them; the fix records the pre-trim offset in
 * the inverse and restores it verbatim, the same recorded-restoration law the
 * slip's `rowLiftBeats` inverse already follows.
 */

function durationDerivedLoopedClip(id: string): Clip {
    return {
        id,
        trackId: 't-keys',
        name: id,
        startBeat: 0,
        endBeat: 8,
        type: 'midi',
        audioOffsetBeats: 0,
        midiOffsetBeats: 0,
        loopEnabled: true,
        loopOriginBeat: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function configuredLoopedClip(id: string): Clip {
    return { ...durationDerivedLoopedClip(id), loopLength: 4 };
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
    const loopLengthBeats = clip.loopLength ?? clip.endBeat - clip.startBeat;
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

/** Slips −1 through the real handler, keeping the inverse it recorded. */
function slipAndKeepInverse(clipId: string): Extract<AppAction, { type: 'slipClipContent' }> {
    const action = {
        type: 'slipClipContent',
        payload: { clipId, clipType: 'midi', offset: -1 },
    } as const;
    const description = handleSlipClipContent.describe(action);
    expect(handleSlipClipContent.execute(action)).toEqual({ status: 'written' });
    if (description.inverseAction?.type !== 'slipClipContent') {
        throw new Error('Expected slip inverse action');
    }
    return description.inverseAction;
}

/** Trims the start 0 → 2 through the real handler, keeping the inverse it recorded. */
function trimAndKeepInverse(clipId: string): Extract<AppAction, { type: 'trimClipStart' }> {
    const action = { type: 'trimClipStart', payload: { clipId, newStartBeat: 2 } } as const;
    const description = handleTrimClipStart.describe(action);
    expect(handleTrimClipStart.execute(action)).toEqual({ status: 'written' });
    if (description.inverseAction?.type !== 'trimClipStart') {
        throw new Error('Expected trim inverse action');
    }
    return description.inverseAction;
}

describe('a slip-then-trim undo chain round-trips the stored figures (#5512)', () => {
    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set(structuredClone(defaultMidiStoreState));
    });

    it('restores the pre-slip figures byte-exactly on a duration-derived loop', () => {
        // The trim wraps its advance against the post-trim duration 6 (raw 9 →
        // phase 3) while its undo replays the wrap against the restored
        // duration 8 — the wrap bases disagree, so the pair leaves the rows
        // displaced and the slip's verbatim restoration lands against the
        // displaced rows. The inverse must restore the pre-trim stored offset
        // verbatim, the way the slip's own inverse restores its capture.
        seed([durationDerivedLoopedClip('c-loop')]);
        const slipInverse = slipAndKeepInverse('c-loop');
        const trimInverse = trimAndKeepInverse('c-loop');

        expect(handleTrimClipStart.execute(trimInverse)).toEqual({ status: 'written' });
        expect(handleSlipClipContent.execute(slipInverse)).toEqual({ status: 'written' });

        const restored = readClip('c-loop');
        expect(restored.startBeat).toBe(0);
        expect(restored.midiOffsetBeats).toBe(0);
        expect(storedNoteBeats('c-loop')).toEqual([0, 1, 2, 3]);
        expect(storedPressBeats('c-loop')).toEqual([0]);
        // The same notes admit after the chain as before it.
        expect(audibleStoredNotes(restored)).toBe(4);
    });

    it('restores the post-slip state byte-exactly at the trim undo alone', () => {
        // The mid-chain observable: undoing the wrap-crossing trim must put
        // back the exact state the slip produced — offset 7, rows lifted to
        // 8..11 — not a re-derived phase of the restored duration.
        seed([durationDerivedLoopedClip('c-loop')]);
        const slipInverse = slipAndKeepInverse('c-loop');
        const trimInverse = trimAndKeepInverse('c-loop');

        expect(handleTrimClipStart.execute(trimInverse)).toEqual({ status: 'written' });

        const restored = readClip('c-loop');
        expect(restored.startBeat).toBe(0);
        expect(restored.midiOffsetBeats).toBe(7);
        expect(storedNoteBeats('c-loop')).toEqual([8, 9, 10, 11]);
        expect(storedPressBeats('c-loop')).toEqual([8]);
        expect(audibleStoredNotes(restored)).toBe(4);
        expect(handleSlipClipContent.execute(slipInverse)).toEqual({ status: 'written' });
        expect(readClip('c-loop').midiOffsetBeats).toBe(0);
        expect(storedNoteBeats('c-loop')).toEqual([0, 1, 2, 3]);
    });

    it('control: the same chain on a configured loopLength composes byte-exactly and stays that way', () => {
        // With a configured length the wrap basis is the same constant on both
        // legs and today's composition is already exact (offset 3 and rows
        // 4..7 restored at the trim undo, then the pre-slip figures). The
        // recorded restoration must keep producing exactly these figures.
        seed([configuredLoopedClip('c-loop')]);
        const slipInverse = slipAndKeepInverse('c-loop');
        const trimInverse = trimAndKeepInverse('c-loop');

        expect(handleTrimClipStart.execute(trimInverse)).toEqual({ status: 'written' });
        expect(readClip('c-loop').midiOffsetBeats).toBe(3);
        expect(storedNoteBeats('c-loop')).toEqual([4, 5, 6, 7]);
        expect(storedPressBeats('c-loop')).toEqual([4]);

        expect(handleSlipClipContent.execute(slipInverse)).toEqual({ status: 'written' });
        const restored = readClip('c-loop');
        expect(restored.midiOffsetBeats).toBe(0);
        expect(storedNoteBeats('c-loop')).toEqual([0, 1, 2, 3]);
        expect(storedPressBeats('c-loop')).toEqual([0]);
        expect(audibleStoredNotes(restored)).toBe(4);
    });
});
