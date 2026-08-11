import { describe, expect, it } from 'vitest';

import { projectShortMidiOverlapRemoval } from '../projectShortMidiOverlapRemoval';

describe('projectShortMidiOverlapRemoval', () => {
    it('shortens only same-pitch/channel overlaps strictly below the millisecond threshold', () => {
        const result = projectShortMidiOverlapRemoval({
            tempo: 120,
            maximumOverlapMs: 30,
            notes: [
                { id: 'short-a', pitch: 60, channel: 0, startBeat: 0, duration: 1.04, velocity: 100 },
                { id: 'short-b', pitch: 60, channel: 0, startBeat: 1, duration: 1, velocity: 90 },
                { id: 'exact-a', pitch: 62, channel: 0, startBeat: 0, duration: 1.06, velocity: 80 },
                { id: 'exact-b', pitch: 62, channel: 0, startBeat: 1, duration: 1, velocity: 70 },
                { id: 'long-a', pitch: 64, channel: 0, startBeat: 0, duration: 1.08, velocity: 60 },
                { id: 'long-b', pitch: 64, channel: 0, startBeat: 1, duration: 1, velocity: 50 },
                { id: 'different-pitch-a', pitch: 65, channel: 0, startBeat: 0, duration: 2, velocity: 40 },
                { id: 'different-pitch-b', pitch: 66, channel: 0, startBeat: 1, duration: 1, velocity: 30 },
                { id: 'different-channel-a', pitch: 67, channel: 1, startBeat: 0, duration: 2, velocity: 20 },
                { id: 'different-channel-b', pitch: 67, channel: 2, startBeat: 1, duration: 1, velocity: 10 },
            ],
        });

        expect(result?.shortenedNotes).toHaveLength(1);
        expect(result?.shortenedNotes[0]).toMatchObject({
            noteId: 'short-a',
            previousDuration: 1.04,
            nextDuration: 1,
        });
        expect(result?.shortenedNotes[0]?.overlapMs).toBeCloseTo(20, 8);
        expect(result?.notes.map(({ id, duration }) => ({ id, duration }))).toEqual([
            { id: 'short-a', duration: 1 },
            { id: 'short-b', duration: 1 },
            { id: 'exact-a', duration: 1.06 },
            { id: 'exact-b', duration: 1 },
            { id: 'long-a', duration: 1.08 },
            { id: 'long-b', duration: 1 },
            { id: 'different-pitch-a', duration: 2 },
            { id: 'different-pitch-b', duration: 1 },
            { id: 'different-channel-a', duration: 2 },
            { id: 'different-channel-b', duration: 1 },
        ]);
    });

    it('converts beat overlap against the current tempo', () => {
        const notes = [
            { id: 'a', pitch: 60, startBeat: 0, duration: 1.04, velocity: 100 },
            { id: 'b', pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
        ];

        expect(
            projectShortMidiOverlapRemoval({ notes, tempo: 120, maximumOverlapMs: 30 })?.shortenedNotes
        ).toHaveLength(1);
        expect(projectShortMidiOverlapRemoval({ notes, tempo: 60, maximumOverlapMs: 30 })?.shortenedNotes).toEqual([]);
    });

    it('rejects ambiguous stacked same-pitch/channel note starts', () => {
        expect(
            projectShortMidiOverlapRemoval({
                tempo: 120,
                maximumOverlapMs: 30,
                notes: [
                    { id: 'a', pitch: 60, channel: 0, startBeat: 1, duration: 1, velocity: 100 },
                    { id: 'b', pitch: 60, channel: 0, startBeat: 1, duration: 2, velocity: 90 },
                ],
            })
        ).toBeNull();
    });
});
