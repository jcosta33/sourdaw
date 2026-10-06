import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Clip, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip } from '#/modules/MIDI/useCases';

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
});
