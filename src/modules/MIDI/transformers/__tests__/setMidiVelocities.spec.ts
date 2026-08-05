import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { setMidiVelocities } from '../setMidiVelocities';

function note(id: string, velocity: number): MidiNote {
    return { id, pitch: 60, startBeat: 0, duration: 1, velocity };
}

describe('setMidiVelocities', () => {
    it('sets every note to the clamped velocity and preserves other fields', () => {
        const result = setMidiVelocities({
            notes: [
                { id: 'a', pitch: 55, startBeat: 2, duration: 0.5, velocity: 10 },
                { id: 'b', pitch: 67, startBeat: 3, duration: 1, velocity: 99 },
            ],
            velocity: 80,
        });
        expect(result).toEqual([
            { id: 'a', pitch: 55, startBeat: 2, duration: 0.5, velocity: 80 },
            { id: 'b', pitch: 67, startBeat: 3, duration: 1, velocity: 80 },
        ]);
    });

    it('clamps velocity above 127 down to 127 and below 1 up to 1', () => {
        const high = setMidiVelocities({ notes: [note('a', 50)], velocity: 200 });
        expect(high[0]?.velocity).toBe(127);

        const low = setMidiVelocities({ notes: [note('b', 50)], velocity: 0 });
        expect(low[0]?.velocity).toBe(1);
    });

    it('does not mutate the input array', () => {
        const original = [note('a', 50)];
        setMidiVelocities({ notes: original, velocity: 90 });
        expect(original[0]?.velocity).toBe(50);
    });
});
