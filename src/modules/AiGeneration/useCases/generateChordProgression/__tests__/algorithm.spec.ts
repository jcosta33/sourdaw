import { describe, it, expect } from 'vitest';

import { generateChordProgression } from '../algorithm';

describe('generateChordProgression (algorithm)', () => {
    it('generates a deterministically seeded progression', () => {
        const result1 = generateChordProgression({
            style: 'pop',
            key: 0, // C
            scale: 'major',
            bars: 4,
            voicing: 'close',
            octave: 4,
            rhythm: 'quarter',
            seed: 12345,
        });

        const result2 = generateChordProgression({
            style: 'pop',
            key: 0,
            scale: 'major',
            bars: 4,
            voicing: 'close',
            octave: 4,
            rhythm: 'quarter',
            seed: 12345,
        });

        expect(result1.notes).toEqual(result2.notes);
        expect(result1.seed).toBe(12345);
    });

    it('generates the correct number of bars and beats based on rhythm', () => {
        // 4 bars of 'whole' rhythm = 4 chords total
        const resultWhole = generateChordProgression({
            style: 'jazz',
            key: 0,
            scale: 'minor',
            bars: 4,
            rhythm: 'whole',
            seed: 1,
        });

        // 4 bars * 1 event per bar = 4 events. Each chord has 3 or 4 notes.
        // For jazz, we use 7ths, so 4 notes per chord.
        // 4 events * 4 notes = 16 notes.
        expect(resultWhole.notes.length).toBe(16);

        // 2 bars of 'quarter' rhythm = 8 chords total
        const resultQuarter = generateChordProgression({
            style: 'pop',
            key: 0,
            scale: 'major',
            bars: 2,
            rhythm: 'quarter',
            seed: 1,
        });
        // Pop uses triads (3 notes). 8 events * 3 notes = 24 notes.
        expect(resultQuarter.notes.length).toBe(24);
    });

    it('applies correct voicings', () => {
        // Power chord = just root and fifth
        const result = generateChordProgression({
            style: 'rock',
            key: 0, // C
            scale: 'major',
            bars: 1,
            voicing: 'power',
            rhythm: 'whole',
            seed: 1,
        });

        // 1 event * 2 notes = 2 notes total
        expect(result.notes.length).toBe(2);

        // Check that it's a root and fifth relationship (7 semitones)
        const pitch1 = result.notes[0]!.pitch;
        const pitch2 = result.notes[1]!.pitch;
        expect(Math.abs(pitch2 - pitch1)).toBe(7);
    });

    it.each([
        { voicing: 'open' as const, expectedOffsets: [0, 4, 19] },
        { voicing: 'spread' as const, expectedOffsets: [0, 16, 31] },
    ])('applies $voicing voicing offsets from the triad root', ({ voicing, expectedOffsets }) => {
        // Both 'rock' progressions start on scale degree 0 (a 'maj' triad), so the
        // root/offsets are deterministic regardless of which progression rng picks.
        const result = generateChordProgression({
            style: 'rock',
            key: 0,
            scale: 'major',
            bars: 1,
            voicing,
            rhythm: 'whole',
            seed: 1,
        });

        const root = result.notes[0]!.pitch;
        const offsets = result.notes.map((note) => note.pitch - root);
        expect(offsets).toEqual(expectedOffsets);
    });

    it.each([
        {
            rhythm: 'half' as const,
            expectedEvents: [
                { startBeat: 0, duration: 2 },
                { startBeat: 2, duration: 2 },
            ],
        },
        {
            rhythm: 'syncopated' as const,
            expectedEvents: [
                { startBeat: 0, duration: 3.5 },
                { startBeat: 3.5, duration: 0.5 },
            ],
        },
    ])('produces the expected chord events for $rhythm rhythm', ({ rhythm, expectedEvents }) => {
        // 'power' voicing keeps each event to 2 notes, so grouping by startBeat
        // reconstructs the raw rhythm events buildRhythmEvents() produced.
        const result = generateChordProgression({
            style: 'rock',
            key: 0,
            scale: 'major',
            bars: 1,
            voicing: 'power',
            rhythm,
            seed: 1,
        });

        const events = [...new Set(result.notes.map((note) => note.startBeat))]
            .sort((a, b) => a - b)
            .map((startBeat) => ({
                startBeat,
                duration: result.notes.find((note) => note.startBeat === startBeat)!.duration,
            }));
        expect(events).toEqual(expectedEvents);
    });

    it('uses extended chord voicings (9th/7th, never a bare triad) for the rnb style', () => {
        // MAJOR_DEGREE_QUALITIES_9TH is ['maj9','min9','min9','maj9','dom7','min9','dim7']
        // — every entry is a 5-note or 4-note chord, so this holds regardless of which
        // rnb progression/degree the seeded rng selects.
        const result = generateChordProgression({
            style: 'rnb',
            key: 0,
            scale: 'major',
            bars: 4,
            voicing: 'close',
            rhythm: 'whole',
            seed: 2,
        });

        const beats = [...new Set(result.notes.map((note) => note.startBeat))];
        expect(beats.length).toBe(4);
        for (const beat of beats) {
            const chordSize = result.notes.filter((note) => note.startBeat === beat).length;
            expect([4, 5]).toContain(chordSize);
        }
    });
});
