import { describe, expect, it } from 'vitest';

import { projectSyncopatedArpeggio } from '../projectSyncopatedArpeggio';

describe('projectSyncopatedArpeggio', () => {
    it('projects offbeat eighths inside each exact chord window from the absolute source voicing', () => {
        const result = projectSyncopatedArpeggio({
            notes: [
                { id: 'g1', pitch: 67, startBeat: 0, duration: 2, velocity: 80, channel: 0 },
                { id: 'c1', pitch: 60, startBeat: 0, duration: 2, velocity: 100, channel: 0 },
                { id: 'e1', pitch: 64, startBeat: 0, duration: 2, velocity: 90, channel: 0 },
                { id: 'a2', pitch: 69, startBeat: 2, duration: 1, velocity: 85, channel: 1 },
                { id: 'f2', pitch: 65, startBeat: 2, duration: 1, velocity: 95, channel: 1 },
            ],
        });

        expect(result?.chordWindows).toEqual([
            { startBeat: 0, endBeat: 2, pitches: [60, 64, 67] },
            { startBeat: 2, endBeat: 3, pitches: [65, 69] },
        ]);
        expect(result?.addedNotes).toEqual([
            { pitch: 60, startBeat: 0.25, duration: 0.25, velocity: 100, channel: 0 },
            { pitch: 64, startBeat: 0.75, duration: 0.25, velocity: 90, channel: 0 },
            { pitch: 67, startBeat: 1.25, duration: 0.25, velocity: 80, channel: 0 },
            { pitch: 60, startBeat: 1.75, duration: 0.25, velocity: 100, channel: 0 },
            { pitch: 65, startBeat: 2.25, duration: 0.25, velocity: 95, channel: 1 },
            { pitch: 69, startBeat: 2.75, duration: 0.25, velocity: 85, channel: 1 },
        ]);
    });

    it.each([
        {
            name: 'a melodic singleton',
            notes: [{ id: 'one', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
        },
        {
            name: 'a broken harmonic boundary',
            notes: [
                { id: 'c', pitch: 60, startBeat: 0, duration: 2, velocity: 100 },
                { id: 'e', pitch: 64, startBeat: 0, duration: 2, velocity: 90 },
                { id: 'f', pitch: 65, startBeat: 3, duration: 1, velocity: 95 },
                { id: 'a', pitch: 69, startBeat: 3, duration: 1, velocity: 85 },
            ],
        },
        {
            name: 'unequal chord-note durations',
            notes: [
                { id: 'c', pitch: 60, startBeat: 0, duration: 2, velocity: 100 },
                { id: 'e', pitch: 64, startBeat: 0, duration: 1, velocity: 90 },
            ],
        },
    ])('fails closed for $name', ({ notes }) => {
        expect(projectSyncopatedArpeggio({ notes })).toBeNull();
    });
});
