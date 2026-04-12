import { describe, it, expect } from 'vitest';
import { createMidiNote } from '../createMidiNote';

describe('createMidiNote', () => {
    it('should create a MidiNote with the given musical parameters', () => {
        const note = createMidiNote(60, 2, 0.5, 90, 75);
        expect(note.pitch).toBe(60);
        expect(note.startBeat).toBe(2);
        expect(note.duration).toBe(0.5);
        expect(note.velocity).toBe(90);
        expect(note.probability).toBe(75);
        expect(note.id).toMatch(/^note-\d+$/);
    });

    it('should default velocity and probability to 100', () => {
        const note = createMidiNote(36, 0, 1);
        expect(note.velocity).toBe(100);
        expect(note.probability).toBe(100);
    });
});
