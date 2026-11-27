import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { mapMidiVelocitiesByCurve } from '../mapMidiVelocitiesByCurve';

function note(id: string, velocity: number): MidiNote {
    return { id, pitch: 60, startBeat: 0, duration: 1, velocity };
}

describe('mapMidiVelocitiesByCurve', () => {
    it('keeps the expand curve inside maxVelocity and lands the loudest note on it', () => {
        const result = mapMidiVelocitiesByCurve({
            notes: [note('soft', 20), note('loud', 100)],
            curve: 'expand',
            minVelocity: 1,
            maxVelocity: 100,
        });

        expect(result.map((n) => n.velocity)).toEqual([1, 100]);
    });

    it('keeps every curve inside minVelocity..maxVelocity', () => {
        const curves = ['linear', 'exponential', 'logarithmic', 's-curve', 'compress', 'expand'];
        const notes = [note('a', 20), note('b', 60), note('c', 80), note('d', 100)];

        for (const curve of curves) {
            const velocities = mapMidiVelocitiesByCurve({ notes, curve, minVelocity: 30, maxVelocity: 100 }).map(
                (n) => n.velocity
            );
            expect(Math.max(...velocities), curve).toBeLessThanOrEqual(100);
            expect(Math.min(...velocities), curve).toBeGreaterThanOrEqual(30);
        }
    });

    it('maps an unknown curve name as linear', () => {
        const notes = [note('a', 20), note('b', 60), note('c', 100)];
        const linear = mapMidiVelocitiesByCurve({ notes, curve: 'linear', minVelocity: 10, maxVelocity: 110 });

        const unknown = mapMidiVelocitiesByCurve({ notes, curve: 'not-a-curve', minVelocity: 10, maxVelocity: 110 });

        expect(unknown.map((n) => n.velocity)).toEqual([10, 60, 110]);
        expect(unknown).toEqual(linear);
    });
});
