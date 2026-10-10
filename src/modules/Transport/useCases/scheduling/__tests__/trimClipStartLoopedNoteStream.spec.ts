import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, type Track, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { trimClipStart } from '#/modules/Arrangement/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip, projectClipMidiEvents } from '#/modules/MIDI/useCases';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { selectMidiNotesForLoopWindow } from '../selectMidiNotesForLoopWindow';

/**
 * A looped clip's scheduler reads its notes at `note.startBeat - midiOffsetBeats`
 * and drops any whose raw relative reaches the loop length — in
 * `selectMidiNotesForLoopWindow`, in `getGrooveProjection`, and in
 * `scheduleMidiNotes`' own admission test. When a trim's advance wraps the
 * stored offset down by `k * loopLength`, the wrap must not move that drop
 * boundary: the trim shifts the clip's stored notes by the same distance, so
 * the selection and the projected stream keep the raw advance's geometry.

 * Reviewer's repro: after an earlier reveal trim the clip plays [2, 12) with
 * loopLength 8 and the offset wrapped to 6; a note recorded at timeline beat 8
 * sits at media 12 (its media origin is `startBeat - offset` = -4). Trimming
 * on to beat 6 advances the raw offset to 10, which wraps down to 2 — and the
 * note must still sound at beat 8.
 */

function loopedClip(): Clip {
    return {
        id: 'c-keys',
        trackId: 't-keys',
        name: 'c-keys',
        startBeat: 2,
        endBeat: 12,
        type: 'midi',
        audioOffsetBeats: 0,
        midiOffsetBeats: 6,
        loopEnabled: true,
        loopLength: 8,
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

// Mirrors createTrack's defaults; the model itself is private to Arrangement.
function midiTrack(clips: Clip[]): Track {
    return {
        id: 't-keys',
        name: 'Keys',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '',
        clips,
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
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-keys',
        alternatives: [{ id: 'alt-keys', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function seedReproState(): void {
    trackStore.set({
        ...defaultTrackState,
        tracks: [midiTrack([loopedClip()])],
    });
    midiStore.set({
        ...defaultMidiStoreState,
        notesByClipId: { 'c-keys': [{ id: 'n-beat-8', pitch: 60, startBeat: 12, duration: 0.25, velocity: 100 }] },
    });
    expect(trimClipStart('c-keys', 6)).toBe(true);
}

describe('trimClipStart keeps a wrapping trim audible on the scheduler stream', () => {
    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set(structuredClone(defaultMidiStoreState));
    });

    it('moves the stored note figure with the offset wrap', () => {
        seedReproState();

        const trimmed = readClip('c-keys');
        expect(trimmed.startBeat).toBe(6);
        expect(trimmed.midiOffsetBeats).toBe(2);

        const notes = getNotesForClip('c-keys');
        // The wrap moved the offset down by one loop, so the note's media figure
        // moves down with it: `note.startBeat - midiOffsetBeats` stays the raw
        // advance's 2 instead of the wrapped 10 every drop gate discards.
        expect(notes.map((note) => note.startBeat)).toEqual([4]);
    });

    it('keeps the second-window note selected and projected at its timeline beat', () => {
        seedReproState();

        const trimmed = readClip('c-keys');
        const notes = getNotesForClip('c-keys');
        const loopLengthBeats = projectClipLoopExpansion({
            clipDurationBeats: trimmed.endBeat - trimmed.startBeat,
            configuredLoopLengthBeats: trimmed.loopLength,
            loopEnabled: trimmed.loopEnabled ?? false,
        }).loopLengthBeats;
        const selected = selectMidiNotesForLoopWindow({
            notes,
            iterationStartBeat: trimmed.startBeat,
            loopLengthBeats,
            midiOffsetBeats: trimmed.midiOffsetBeats ?? 0,
            fromBeat: 7.5,
            toBeat: 8.5,
            lastScheduledBeat: 7.5,
            // Mirrors scheduleMidiNotes' MIDI_NOTE_GROOVE_LOOKAROUND_BEATS.
            grooveLookaroundBeats: 1,
            // The same anchored window the live admission test reads.
            clipStartBeat: trimmed.startBeat,
            loopOriginBeat: trimmed.loopOriginBeat,
            loopEnabled: trimmed.loopEnabled ?? false,
        });
        expect(selected.map((note) => note.id)).toEqual(['n-beat-8']);

        const projected = projectClipMidiEvents({
            events: selected,
            clipId: trimmed.id,
            clipStartBeat: trimmed.startBeat,
            clipEndBeat: trimmed.endBeat,
            iterationStartBeat: trimmed.startBeat,
            loopLengthBeats,
            midiOffsetBeats: trimmed.midiOffsetBeats ?? 0,
            loopEnabled: trimmed.loopEnabled ?? false,
        });
        expect(projected.map((event) => event.startBeat)).toEqual([8]);
    });
});
