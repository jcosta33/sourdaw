import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, type Track, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { trimClipStart } from '#/modules/Arrangement/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip, projectClipMidiEvents } from '#/modules/MIDI/useCases';
import { CLIP_LOOP_WINDOW_BEAT_TOLERANCE, isBeatInClipLoopWindow } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { selectMidiNotesForLoopWindow } from '../selectMidiNotesForLoopWindow';

/**
 * The anchored window's floor and ceiling sit at exactly the stored
 * coordinates of the loop-head and loop-end notes, but the two figures
 * descend from different rounding chains: stored notes carry the trim offset's
 * `wrapped - raw` shift while the window bounds read
 * `startBeat - loopOriginBeat`. Where the chains disagree by an ulp, a strict
 * comparison flips admission — a triplet-grid trim chain doubled the loop-end
 * note-on, and a deep wrapping trim silenced the loop head (#5198). The
 * tolerant membership law must hold through the real trim → selection →
 * projection path, not only in the util's unit figures, and each direction
 * here fails on a strict-comparison implementation (the precondition asserts
 * pin the drift the tolerance exists to absorb).
 */

function loopedClip(): Clip {
    return {
        id: 'c-keys',
        trackId: 't-keys',
        name: 'c-keys',
        startBeat: 0,
        endBeat: 32,
        type: 'midi',
        audioOffsetBeats: 0,
        midiOffsetBeats: 0,
        loopEnabled: true,
        loopLength: 4,
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

function seed(notes: { id: string; startBeat: number }[]): void {
    trackStore.set({
        ...defaultTrackState,
        tracks: [midiTrack([loopedClip()])],
    });
    midiStore.set({
        ...defaultMidiStoreState,
        notesByClipId: {
            'c-keys': notes.map((note) => ({
                id: note.id,
                pitch: 60,
                startBeat: note.startBeat,
                duration: 0.25,
                velocity: 100,
            })),
        },
    });
}

function loopWindowStream(trimmed: Clip): { selected: string[]; projected: string[] } {
    const loopLengthBeats = projectClipLoopExpansion({
        clipDurationBeats: trimmed.endBeat - trimmed.startBeat,
        configuredLoopLengthBeats: trimmed.loopLength,
        loopEnabled: trimmed.loopEnabled ?? false,
    }).loopLengthBeats;
    const selected = selectMidiNotesForLoopWindow({
        notes: getNotesForClip(trimmed.id),
        iterationStartBeat: trimmed.startBeat,
        loopLengthBeats,
        midiOffsetBeats: trimmed.midiOffsetBeats ?? 0,
        fromBeat: trimmed.startBeat,
        toBeat: trimmed.startBeat + loopLengthBeats,
        lastScheduledBeat: trimmed.startBeat,
        grooveLookaroundBeats: 1,
        clipStartBeat: trimmed.startBeat,
        loopOriginBeat: trimmed.loopOriginBeat,
        loopEnabled: trimmed.loopEnabled ?? false,
    });
    const projected = projectClipMidiEvents({
        events: selected,
        clipId: trimmed.id,
        clipStartBeat: trimmed.startBeat,
        clipEndBeat: trimmed.endBeat,
        iterationStartBeat: trimmed.startBeat,
        loopLengthBeats,
        midiOffsetBeats: trimmed.midiOffsetBeats ?? 0,
        loopEnabled: trimmed.loopEnabled ?? false,
        loopOriginBeat: trimmed.loopOriginBeat,
    });
    return {
        selected: selected.map((note) => note.id),
        projected: projected.map((event) => event.id),
    };
}

describe('anchored loop-window boundaries under rounding-chain drift (#5198)', () => {
    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set(structuredClone(defaultMidiStoreState));
    });

    it('keeps the drifted loop-end note out of every pass after triplet-grid trims', () => {
        seed([
            { id: 'n-head', startBeat: 0 },
            { id: 'n-end', startBeat: 4 },
        ]);
        expect(trimClipStart('c-keys', 1 / 6)).toBe(true);
        expect(trimClipStart('c-keys', 1 / 6 + 1 / 4)).toBe(true);

        const trimmed = readClip('c-keys');
        const notes = getNotesForClip('c-keys');
        const head = notes.find((note) => note.id === 'n-head')!;
        const end = notes.find((note) => note.id === 'n-end')!;
        const midiOffsetBeats = trimmed.midiOffsetBeats ?? 0;
        const floorBeat = -(trimmed.startBeat - (trimmed.loopOriginBeat ?? 0));
        const ceilingBeat = floorBeat + 4;
        const endRelative = end.startBeat - midiOffsetBeats;
        const headRelative = head.startBeat - midiOffsetBeats;

        // The drift precondition: the loop-end note sits strictly inside the
        // naive ceiling (so a strict comparison admits it a second time), and
        // inside the tolerance the predicate softens by.
        expect(ceilingBeat - endRelative).toBeGreaterThan(0);
        expect(ceilingBeat - endRelative).toBeLessThanOrEqual(CLIP_LOOP_WINDOW_BEAT_TOLERANCE);

        const window = (relativeBeat: number) =>
            isBeatInClipLoopWindow({
                relativeBeat,
                startBeat: trimmed.startBeat,
                loopOriginBeat: trimmed.loopOriginBeat,
                loopLengthBeats: 4,
                loopEnabled: true,
            });
        expect(window(headRelative)).toBe(true);
        expect(window(endRelative)).toBe(false);

        const { selected, projected } = loopWindowStream(trimmed);
        expect(selected).toEqual(['n-head']);
        expect(projected).toEqual(['n-head']);
    });

    it('keeps the loop-head downbeat sounding after deep wrapping trims', () => {
        seed([
            { id: 'n-head', startBeat: 0 },
            { id: 'n-end', startBeat: 4 },
        ]);
        expect(trimClipStart('c-keys', 4.1)).toBe(true);
        expect(trimClipStart('c-keys', 20.3)).toBe(true);

        const trimmed = readClip('c-keys');
        const notes = getNotesForClip('c-keys');
        const head = notes.find((note) => note.id === 'n-head')!;
        const midiOffsetBeats = trimmed.midiOffsetBeats ?? 0;
        const floorBeat = -(trimmed.startBeat - (trimmed.loopOriginBeat ?? 0));
        const headRelative = head.startBeat - midiOffsetBeats;

        // The drift precondition on the other bound: the head's stored figure
        // lands strictly below the naive floor (so a strict comparison
        // silences the downbeat), and inside the tolerance.
        expect(headRelative).toBeLessThan(floorBeat);
        expect(floorBeat - headRelative).toBeLessThanOrEqual(CLIP_LOOP_WINDOW_BEAT_TOLERANCE);

        const { selected, projected } = loopWindowStream(trimmed);
        expect(selected).toEqual(['n-head']);
        expect(projected).toEqual(['n-head']);
    });
});
