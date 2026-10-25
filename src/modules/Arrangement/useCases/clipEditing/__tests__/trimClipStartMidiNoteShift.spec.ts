import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Clip, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip, projectClipControllerEvents } from '#/modules/MIDI/useCases';

import { createTrack } from '../../../models/Track';
import { trimClipStart } from '../trimClipStart';

/**
 * Trimming a clip's left edge hides its head; it never moves the material that
 * stays. A MIDI note plays at `clip.startBeat - midiOffsetBeats + note.startBeat`
 * (the renderer's `note.startBeat - midiOffset`, the recorder's
 * `clipMediaOrigin`), so a trim that advances `startBeat` must advance
 * `midiOffsetBeats` by the same amount or every surviving note plays late by the
 * trim distance. The audio case is the control: its media origin already holds.
 */

function clip(id: string, trackId: string, type: Clip['type']): Clip {
    return {
        id,
        trackId,
        name: id,
        startBeat: 0,
        endBeat: 8,
        type,
        audioOffsetBeats: 0,
        midiOffsetBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function readClip(clipId: string): Clip {
    const found = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!found) {
        throw new Error(`Expected clip ${clipId} in the track store`);
    }
    return found;
}

/** The absolute beat a note written at clip-relative beat 0 sounds on. */
function midiMediaOrigin(target: Clip): number {
    return target.startBeat - (target.midiOffsetBeats ?? 0);
}

function audioMediaOrigin(target: Clip): number {
    return target.startBeat - (target.audioOffsetBeats ?? 0);
}

describe('trimClipStart keeps the surviving material where it was', () => {
    beforeEach(() => {
        const keys = createTrack({ id: 't-keys', name: 'Keys', kind: 'midi', withoutDefaultDevice: true });
        const vocal = createTrack({ id: 't-vocal', name: 'Vocal', kind: 'audio' });
        trackStore.set({
            ...defaultTrackState,
            tracks: [
                { ...keys, clips: [clip('c-keys', 't-keys', 'midi')] },
                { ...vocal, clips: [clip('c-vocal', 't-vocal', 'audio')] },
            ],
        });
    });

    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
    });

    it('control: an audio clip trimmed by two beats keeps its audio at the same timeline position', () => {
        expect(trimClipStart('c-vocal', 2)).toBe(true);

        const trimmed = readClip('c-vocal');
        expect(trimmed.startBeat).toBe(2);
        expect(audioMediaOrigin(trimmed)).toBe(0);
    });

    it('a MIDI clip trimmed by two beats keeps its notes at the same timeline position', () => {
        expect(trimClipStart('c-keys', 2)).toBe(true);

        const trimmed = readClip('c-keys');
        expect(trimmed.startBeat).toBe(2);
        expect(midiMediaOrigin(trimmed)).toBe(0);
    });
});

describe('trimClipStart keeps a looped MIDI clip inside its loop', () => {
    /** The scheduler reads a looped clip's notes at `note.startBeat - midiOffsetBeats` wrapped by the loop length. */
    function loopedClip(id: string, trackId: string, startBeat: number, endBeat: number): Clip {
        return { ...clip(id, trackId, 'midi'), startBeat, endBeat, loopEnabled: true, loopLength: 8 };
    }

    function seed(clips: Clip[]): void {
        const keys = createTrack({ id: 't-keys', name: 'Keys', kind: 'midi', withoutDefaultDevice: true });
        trackStore.set({
            ...defaultTrackState,
            tracks: [{ ...keys, clips }],
        });
    }

    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set(structuredClone(defaultMidiStoreState));
    });

    it('control: trimming within the loop keeps the media origin like an unlooped clip', () => {
        seed([loopedClip('c-keys', 't-keys', 0, 16)]);

        expect(trimClipStart('c-keys', 2)).toBe(true);

        const trimmed = readClip('c-keys');
        expect(trimmed.startBeat).toBe(2);
        expect(trimmed.midiOffsetBeats).toBe(2);
    });

    it('trimming past one loop length keeps the offset inside the loop at the same phase', () => {
        seed([loopedClip('c-keys', 't-keys', 0, 16)]);

        expect(trimClipStart('c-keys', 10)).toBe(true);

        const trimmed = readClip('c-keys');
        expect(trimmed.startBeat).toBe(10);
        // The naive advance stores 10; the loop plays phase `(0 + 10) mod 8`, so the
        // stored figure stays that phase inside `[0, loopLength)`.
        expect(trimmed.midiOffsetBeats).toBe(2);
    });

    it('revealing space before a looped clip keeps the offset inside the loop at the same phase', () => {
        seed([loopedClip('c-keys', 't-keys', 4, 12)]);

        expect(trimClipStart('c-keys', 2)).toBe(true);

        const trimmed = readClip('c-keys');
        expect(trimmed.startBeat).toBe(2);
        // The naive advance stores -2, whose raw relatives make the scheduler drop the
        // loop's head notes (relative `>= loopLength`) at every iteration; the wrapped
        // figure carries the same phase without the drop.
        expect(trimmed.midiOffsetBeats).toBe(6);
    });

    it('moving the offset with the wrap shifts the stored notes by the same distance', () => {
        seed([loopedClip('c-keys', 't-keys', 4, 12)]);
        midiStore.set({
            ...defaultMidiStoreState,
            notesByClipId: { 'c-keys': [{ id: 'n-beat-8', pitch: 60, startBeat: 4, duration: 0.25, velocity: 100 }] },
        });

        expect(trimClipStart('c-keys', 2)).toBe(true);

        // The wrap moved the offset up by one loop, so the note's media figure moves
        // up with it: `note.startBeat - midiOffsetBeats` stays the raw advance's
        // relative (4 - (-2) = 6) instead of drifting to the wrapped -2.
        expect(readClip('c-keys').midiOffsetBeats).toBe(6);
        expect(getNotesForClip('c-keys').map((note) => note.startBeat)).toEqual([12]);

        expect(trimClipStart('c-keys', 6)).toBe(true);

        // The raw advance is 10, which wraps down by one loop; the note comes back
        // to media 4 and its raw relative stays 2 instead of the wrapped 10 that
        // every scheduler drop gate would discard.
        expect(readClip('c-keys').midiOffsetBeats).toBe(2);
        expect(getNotesForClip('c-keys').map((note) => note.startBeat)).toEqual([4]);
    });

    describe('with a note and a controller press on the same content beat', () => {
        function pressRow(): { id: string; controller: number; value: number; beat: number; channel: number } {
            return { id: 'cc-64', controller: 64, value: 127, beat: 0, channel: 0 };
        }

        function seedAnchoredFourBeatLoop(): void {
            seed([
                {
                    ...clip('c-keys', 't-keys', 'midi'),
                    startBeat: 4,
                    endBeat: 16,
                    loopEnabled: true,
                    loopLength: 4,
                    loopOriginBeat: 4,
                },
            ]);
            midiStore.set({
                ...defaultMidiStoreState,
                notesByClipId: { 'c-keys': [{ id: 'n-head', pitch: 60, startBeat: 0, duration: 0.25, velocity: 100 }] },
                ccByClipId: { 'c-keys': [pressRow()] },
            });
        }

        function storedPressBeats(): number[] {
            return (midiStore.value?.ccByClipId['c-keys'] ?? []).map((row) => row.beat);
        }

        function projectedPresses(fromBeat: number, toBeat: number): number[] {
            const rows = midiStore.value?.ccByClipId['c-keys'] ?? [];
            return projectClipControllerEvents({
                controlChanges: rows,
                clip: readClip('c-keys'),
                fromBeat,
                toBeat,
            }).map((event) => event.beat);
        }

        it('a trim across one loop length fires the press at every pass the note sounds', () => {
            // Advance exactly one 4-beat loop (start 4 -> 8): the wrap re-bases the
            // offset down to 0, so the stored rows must ride the same -4 the notes
            // get. A press left at beat 0 sits outside the anchored region the
            // projector reads ([-4, 0)) and the clip plays in total silence while
            // the note sounds at both pass heads.
            seedAnchoredFourBeatLoop();

            expect(trimClipStart('c-keys', 8)).toBe(true);

            expect(readClip('c-keys').midiOffsetBeats).toBe(0);
            expect(getNotesForClip('c-keys').map((note) => note.startBeat)).toEqual([-4]);
            expect(storedPressBeats()).toEqual([-4]);
            expect(projectedPresses(8, 16)).toEqual([8, 12]);
        });

        it('a sub-loop trim moves the press with the notes — which is not at all', () => {
            // Delta 2 is non-zero but below the loop, so the wrap never re-bases:
            // the shift is zero and both rows stay put. The press (content 0) now
            // sits at the region's wrapped head, so the projector replays it at
            // 8 and 12 — the passes the note sounds — and its value-in-force rule
            // carries the held pedal to the pass heads 6, 10, 14. The carries are
            // the projector's hold semantics, not relocations: the stored row
            // itself never left beat 0.
            seedAnchoredFourBeatLoop();

            expect(trimClipStart('c-keys', 6)).toBe(true);

            expect(readClip('c-keys').midiOffsetBeats).toBe(2);
            expect(getNotesForClip('c-keys').map((note) => note.startBeat)).toEqual([0]);
            expect(storedPressBeats()).toEqual([0]);
            expect(projectedPresses(6, 16)).toEqual([6, 8, 10, 12, 14]);
        });
    });
});
