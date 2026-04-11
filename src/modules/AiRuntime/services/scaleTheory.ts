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

/** Build chord from scale degrees (0-indexed) at a beat */
export function chordFromDegrees(
    degrees: number[],
    scalePitches: number[],
    octaveBase: number,
    beat: number,
    dur: number,
    vel = 80
): PatternNote[] {
    return degrees.map((deg) => {
        const idx = Math.min(deg + octaveBase, scalePitches.length - 1);
        return { pitch: scalePitches[Math.max(0, idx)]!, velocity: vel, startBeat: beat, durationBeats: dur };
    });
}

/** Filter pattern templates by category, genres, tags, and free-text query. */
export function filterTemplates(templates: PatternTemplate[], filters: PatternFilters): PatternTemplate[] {
    return templates.filter((t) => {
        if (filters.category && t.category !== filters.category) {
            return false;
        }
        if (filters.genres && !filters.genres.some((g) => t.genres.includes(g))) {
            return false;
        }
        if (filters.tags && !filters.tags.some((tag) => t.tags.includes(tag))) {
            return false;
        }
        if (filters.query) {
            const q = filters.query.toLowerCase();
            const haystack = [t.name, t.description, ...t.tags, ...t.genres].join(' ').toLowerCase();
            if (!haystack.includes(q)) {
                return false;
            }
        }
        return true;
    });
}
