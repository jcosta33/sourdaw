import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { invertMidiNotes } from '../invertMidiNotes';

function note(id: string, pitch: number, startBeat = 0, duration = 1): MidiNote {
    return { id, pitch, startBeat, duration, velocity: 100 };
}

describe('invertMidiNotes', () => {
    it('clones each note unchanged when fewer than 2 notes', () => {
        const empty = invertMidiNotes([]);
        expect(empty).toEqual([]);

        const single = invertMidiNotes([note('a', 60)]);
        expect(single).toEqual([note('a', 60)]);
        // Returns fresh objects, not the same reference.
        expect(single[0]).not.toBe(note('a', 60));
    });

    it('mirrors pitches around the min+max axis', () => {
        // min=48, max=72, axis=120. 48↔72, 60↔60.
        const result = invertMidiNotes([note('a', 48), note('b', 60), note('c', 72)]);
        expect(result.map((n) => n.pitch)).toEqual([72, 60, 48]);
    });

    it('preserves startBeat, duration, and velocity while flipping pitch', () => {
        const result = invertMidiNotes([
            { id: 'a', pitch: 50, startBeat: 2, duration: 0.5, velocity: 88 },
            { id: 'b', pitch: 70, startBeat: 3, duration: 1, velocity: 99 },
        ]);
        // axis = 50 + 70 = 120; 50→70, 70→50
        expect(result).toEqual([
            { id: 'a', pitch: 70, startBeat: 2, duration: 0.5, velocity: 88 },
            { id: 'b', pitch: 50, startBeat: 3, duration: 1, velocity: 99 },
        ]);
    });

    it('clamps inverted pitches to the MIDI range [0, 127]', () => {
        // min=0, max=127, axis=127. 0→127, 10→117, 127→0.
        const result = invertMidiNotes([note('a', 0), note('b', 10), note('c', 127)]);
        expect(result.map((n) => n.pitch)).toEqual([127, 117, 0]);
    });
});
