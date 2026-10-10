import { beforeEach, describe, expect, it } from 'vitest';

import { type Clip, type Track, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { setClipLoop, trimClipStart } from '#/modules/Arrangement/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip, projectClipMidiEvents, setNotesForClip } from '#/modules/MIDI/useCases';
import { isBeatInClipLoopWindow } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { selectMidiNotesForLoopWindow } from '../selectMidiNotesForLoopWindow';

/**
 * Review probe (#5198, loop-window-admission stance), folded: a looped clip's
 * start trims advance its head past the anchor stamped at loop enable, and a
 * LEFTWARD trim carries a negative advance whose anchored window
 * `[−advance, loopLength − advance)` has its ceiling above the loop length.
 * The live candidate generator must offer at least everything that window
 * admits — the old one-sided `relative >= loopLength` index bound dropped
 * exactly that material — and what it offers must project into exactly the
 * pass the offline projector sounds, for every trim direction.
 */

// Mirrors scheduleMidiNotes' MIDI_NOTE_GROOVE_LOOKAROUND_BEATS.
const LOOKAROUND_BEATS = 1;

function loopedClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'c-loop',
        trackId: 't-keys',
        name: 'c-loop',
        startBeat: 4,
        endBeat: 12,
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
        ...overrides,
    };
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

function readClip(clipId: string): Clip {
    const found = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!found) {
        throw new Error(`Expected clip ${clipId}`);
    }
    return found;
}

/**
 * Loop established at beat 4 (anchor 4), one note per loop phase; the trim
 * then moves the head through the real use case, which stamps and carries the
 * anchor and re-bases the stored offset exactly as production does.
 */
function seedTrimmedLoopedClip(trimTo: number | null): {
    clip: Clip;
    notes: ReturnType<typeof getNotesForClip>;
    loopLengthBeats: number;
} {
    trackStore.set({
        ...defaultTrackState,
        tracks: [midiTrack([loopedClip()])],
    });
    expect(setClipLoop('c-loop', true)).toBe(true);
    setNotesForClip(
        'c-loop',
        [0, 1, 2, 3].map((beat) => ({
            id: `n-${beat}`,
            pitch: 60,
            startBeat: beat,
            duration: 0.5,
            velocity: 100,
        }))
    );
    if (trimTo !== null) {
        expect(trimClipStart('c-loop', trimTo)).toBe(true);
    }
    const clip = readClip('c-loop');
    const loopLengthBeats = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    }).loopLengthBeats;
    return { clip, notes: getNotesForClip('c-loop'), loopLengthBeats };
}

const SCENARIOS = [
    { label: 'zero advance (loop enabled, untrimmed)', trimTo: null, expectedAdvance: 0 },
    { label: 'positive advance (head trimmed right past the anchor)', trimTo: 6, expectedAdvance: 2 },
    { label: 'negative advance, non-multiple of the loop (head extended left by 2)', trimTo: 2, expectedAdvance: -2 },
    { label: 'negative advance, exact loop multiple (head extended left by one loop)', trimTo: 0, expectedAdvance: -4 },
] as const;

describe.each(SCENARIOS)('loop-window advance admission — $label', ({ trimTo, expectedAdvance }) => {
    beforeEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set(structuredClone(defaultMidiStoreState));
    });

    it('the live generator offers every windowed note and projects the offline pass', () => {
        const { clip, notes, loopLengthBeats } = seedTrimmedLoopedClip(trimTo);
        const loopEnabled = clip.loopEnabled ?? false;
        const offset = clip.midiOffsetBeats ?? 0;
        expect(clip.startBeat - (clip.loopOriginBeat ?? clip.startBeat)).toBe(expectedAdvance);

        const fromBeat = clip.startBeat;
        const toBeat = fromBeat + loopLengthBeats;
        const projectionInput = {
            clipId: clip.id,
            clipStartBeat: clip.startBeat,
            clipEndBeat: clip.endBeat,
            iterationStartBeat: clip.startBeat,
            loopLengthBeats,
            midiOffsetBeats: offset,
            loopEnabled,
            loopOriginBeat: clip.loopOriginBeat,
        };

        // The live candidate generator, driven exactly as scheduleMidiNotes
        // drives it for the pass covering the clip head's full loop.
        const candidates = selectMidiNotesForLoopWindow({
            notes,
            iterationStartBeat: clip.startBeat,
            loopLengthBeats,
            midiOffsetBeats: offset,
            fromBeat,
            toBeat,
            lastScheduledBeat: fromBeat,
            grooveLookaroundBeats: LOOKAROUND_BEATS,
            clipStartBeat: clip.startBeat,
            loopOriginBeat: clip.loopOriginBeat,
            loopEnabled,
        });

        // The never-under-admit contract: every note the anchored two-sided
        // window admits reaches the caller's per-note admission test.
        const candidateIds = new Set(candidates.map((note) => note.id));
        for (const note of notes) {
            const windowed = isBeatInClipLoopWindow({
                relativeBeat: note.startBeat - offset,
                startBeat: clip.startBeat,
                loopOriginBeat: clip.loopOriginBeat,
                loopLengthBeats,
                loopEnabled,
            });
            if (windowed) {
                expect(
                    candidateIds.has(note.id),
                    `the generator must offer windowed note ${note.id} (advance ${expectedAdvance})`
                ).toBe(true);
            }
        }

        // Live/offline agreement: the candidates, projected per note as the
        // live caller projects them and filtered to the pass, sound exactly
        // what the offline projector sounds over the clip's whole note set.
        const soundedEvents = (events: readonly { id: string; startBeat: number }[]) => {
            const inPass = events.filter((event) => event.startBeat >= fromBeat && event.startBeat < toBeat);
            const sounded = inPass.map((event) => ({ id: event.id, startBeat: event.startBeat }));
            return sounded.sort((left, right) => left.startBeat - right.startBeat || left.id.localeCompare(right.id));
        };
        const live = soundedEvents(
            candidates.flatMap((note) => projectClipMidiEvents({ events: [note], ...projectionInput }))
        );
        const offline = soundedEvents(projectClipMidiEvents({ events: notes, ...projectionInput }));
        expect(live).toEqual(offline);
        expect(live.length, 'the pass must stay audible').toBeGreaterThan(0);
    });
});
