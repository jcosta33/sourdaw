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
});
