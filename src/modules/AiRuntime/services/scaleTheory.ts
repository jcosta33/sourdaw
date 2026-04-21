/**
 * Pure music-theory helpers used by MIDI pattern templates: scale-pitch
 * generation, snap-to-scale, chord building from scale degrees, and
 * pattern-template filtering.
 *
 * No state, no I/O. Templates and types live in `models/MidiPatternType.ts`;
 * the aggregated catalog lives in `models/midiPatternLibrary.ts`.
 */

import {
    type KeyName,
    type ScaleType,
    type PatternNote,
    type PatternTemplate,
    type PatternFilters,
    KEY_SEMITONES,
    SCALE_INTERVALS,
} from '../models/MidiPatternType';

/** Get MIDI pitches for a scale across a note range */
export function getScalePitches(key: KeyName, scale: ScaleType, low = 36, high = 96): number[] {
    const root = KEY_SEMITONES[key] ?? 0;
    const intervals = SCALE_INTERVALS[scale];
    const pitches: number[] = [];
    for (let midi = low; midi <= high; midi++) {
        if (intervals.includes((midi - root + 120) % 12)) {
            pitches.push(midi);
        }
    }
    return pitches;
}

/** Snap a pitch to the nearest scale tone */
export function snapToScale(pitch: number, scalePitches: number[]): number {
    let best = scalePitches[0]!;
    for (const sp of scalePitches) {
        if (Math.abs(sp - pitch) < Math.abs(best - pitch)) {
            best = sp;
        }
    }
    return best;
}

/**
 * Count how many distinct scale tones fit inside a single octave of a
 * pre-computed `scalePitches` array (diatonic = 7, pentatonic = 5, blues = 6,
 * etc.). Used by {@link chordFromDegrees} to wrap by octave instead of
 * clamping the top index — the old behaviour silently collapsed chord tones
 * that would have landed above the scale range onto the same top pitch.
 */
function detectNotesPerOctave(scalePitches: number[]): number {
    if (scalePitches.length === 0) {
        return 1;
    }
    const first = scalePitches[0]!;
    let count = 0;
    for (const pitch of scalePitches) {
        if (pitch - first >= 12) {
            break;
        }
        count++;
    }
    return count === 0 ? scalePitches.length : count;
}

/** Build chord from scale degrees (0-indexed) at a beat */
export function chordFromDegrees(
    degrees: number[],
    scalePitches: number[],
    octaveBase: number,
    beat: number,
    dur: number,
    vel = 80
): PatternNote[] {
    if (scalePitches.length === 0) {
        return [];
    }
    const notesPerOctave = detectNotesPerOctave(scalePitches);
    return degrees.map((deg) => {
        const absoluteDegree = deg + octaveBase;
        // §14.4 — wrap scale degrees by octave instead of clamping to the top
        // pitch. A chord like `[0, 2, 4, 7]` on a short pentatonic scale near
        // the top of the range used to collapse to four copies of the highest
        // scale tone; now it climbs into the next octave naturally.
        const octavesFromBase = Math.floor(absoluteDegree / notesPerOctave);
        const degreeInOctave = ((absoluteDegree % notesPerOctave) + notesPerOctave) % notesPerOctave;
        const pitch = scalePitches[degreeInOctave]! + 12 * octavesFromBase;
        return { pitch, velocity: vel, startBeat: beat, durationBeats: dur };
    });
}

/** Filter pattern templates by category, genres, tags, and free-text query. */
export function filterTemplates(templates: PatternTemplate[], filters: PatternFilters): PatternTemplate[] {
    return templates.filter((time) => {
        if (filters.category && time.category !== filters.category) {
            return false;
        }
        if (filters.genres && !filters.genres.some((g) => time.genres.includes(g))) {
            return false;
        }
        if (filters.tags && !filters.tags.some((tag) => time.tags.includes(tag))) {
            return false;
        }
        if (filters.query) {
            const query = filters.query.toLowerCase();
            const haystack = [time.name, time.description, ...time.tags, ...time.genres].join(' ').toLowerCase();
            if (!haystack.includes(query)) {
                return false;
            }
        }
        return true;
    });
}
