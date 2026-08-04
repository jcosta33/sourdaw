import { describe, it, expect } from 'vitest';

import { buildSeedNotesFromPrompt } from '../buildSeedNotesFromPrompt';

describe('buildSeedNotesFromPrompt — default (no key specified)', () => {
    it('returns C major scale fragment when no key/mode is found', () => {
        const notes = buildSeedNotesFromPrompt('chill beat');
        // root = C4 (60), major steps [0,2,4,5] → [60, 62, 64, 65]
        expect(notes).toEqual([
            [60, 80, 0, 0.5],
            [62, 75, 0.5, 0.5],
            [64, 85, 1, 0.5],
            [65, 80, 1.5, 0.5],
        ]);
    });

    it('does not match "c" inside a word like "chill"', () => {
        const notes = buildSeedNotesFromPrompt('chill vibes');
        // root stays C (60) — no match.
        expect(notes[0]?.[0]).toBe(60);
    });
});

describe('buildSeedNotesFromPrompt — key + mode matching', () => {
    it('matches F# minor → root 66, minor scale', () => {
        const notes = buildSeedNotesFromPrompt('bass in F# minor');
        // root = 60 + 6 = 66. Minor: [0,2,3,5] → [66, 68, 69, 71].
        expect(notes.map((n) => n[0])).toEqual([66, 68, 69, 71]);
    });

    it('matches D major → root 62, major scale', () => {
        const notes = buildSeedNotesFromPrompt('play D major');
        expect(notes.map((n) => n[0])).toEqual([62, 64, 66, 67]);
    });

    it('matches Bb minor → root 70, minor scale (flat notation)', () => {
        const notes = buildSeedNotesFromPrompt('Bb minor groove');
        // bb → pc 10. root = 70. Minor: [0,2,3,5] → [70, 72, 73, 75].
        expect(notes.map((n) => n[0])).toEqual([70, 72, 73, 75]);
    });

    it('matches Db major → root 61 (flat notation)', () => {
        const notes = buildSeedNotesFromPrompt('Db major');
        expect(notes[0]?.[0]).toBe(61);
    });

    it('matches "maj" abbreviation as major', () => {
        const notes = buildSeedNotesFromPrompt('E maj');
        // E → pc 4. root = 64. Major: [0,2,4,5] → [64,66,68,69].
        expect(notes.map((n) => n[0])).toEqual([64, 66, 68, 69]);
    });

    it('matches "min" abbreviation as minor', () => {
        const notes = buildSeedNotesFromPrompt('A min');
        // A → pc 9. root = 69. Minor: [0,2,3,5] → [69,71,72,74].
        expect(notes.map((n) => n[0])).toEqual([69, 71, 72, 74]);
    });

    it('is case-insensitive', () => {
        const lower = buildSeedNotesFromPrompt('f# minor');
        const upper = buildSeedNotesFromPrompt('F# MINOR');
        expect(lower).toEqual(upper);
    });
});

describe('buildSeedNotesFromPrompt — note structure', () => {
    it('each note is [pitch, velocity, startBeat, duration]', () => {
        const notes = buildSeedNotesFromPrompt('C major');
        for (const note of notes) {
            expect(note).toHaveLength(4);
            expect(typeof note[0]).toBe('number'); // pitch
            expect(typeof note[1]).toBe('number'); // velocity
            expect(typeof note[2]).toBe('number'); // startBeat
            expect(typeof note[3]).toBe('number'); // duration
        }
    });

    it('velocities are [80, 75, 85, 80]', () => {
        const notes = buildSeedNotesFromPrompt('C major');
        expect(notes.map((n) => n[1])).toEqual([80, 75, 85, 80]);
    });

    it('startBeats are [0, 0.5, 1, 1.5]', () => {
        const notes = buildSeedNotesFromPrompt('C major');
        expect(notes.map((n) => n[2])).toEqual([0, 0.5, 1, 1.5]);
    });

    it('all durations are 0.5 beats', () => {
        const notes = buildSeedNotesFromPrompt('C major');
        expect(notes.every((n) => n[3] === 0.5)).toBe(true);
    });
});
