import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { scaleMidiVelocities } from '../scaleMidiVelocities';

function note(id: string, velocity: number): MidiNote {
    return { id, pitch: 60, startBeat: 0, duration: 1, velocity };
}

describe('scaleMidiVelocities', () => {
    it('multiplies each velocity by the factor, rounded', () => {
        const result = scaleMidiVelocities({
            notes: [note('a', 100), note('b', 60)],
            factor: 1.5,
        });
        // 100 * 1.5 = 150 → clamped to 127
        // 60 * 1.5 = 90
        expect(result.map((n) => n.velocity)).toEqual([127, 90]);
    });

    it('clamps scaled velocity to [1, 127]', () => {
        const boosted = scaleMidiVelocities({ notes: [note('a', 100)], factor: 5 });
        expect(boosted[0]?.velocity).toBe(127);

        const attenuated = scaleMidiVelocities({ notes: [note('b', 10)], factor: 0.01 });
        // 10 * 0.01 = 0.1 → round to 0 → clamped to 1
        expect(attenuated[0]?.velocity).toBe(1);
    });

    it('preserves pitch, startBeat, and duration', () => {
        const result = scaleMidiVelocities({
            notes: [{ id: 'a', pitch: 72, startBeat: 4, duration: 2, velocity: 80 }],
            factor: 0.5,
        });
        expect(result[0]).toEqual({
            id: 'a',
            pitch: 72,
            startBeat: 4,
            duration: 2,
            velocity: 40,
        });
    });
});
