import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../../../models/SameBeatTolerance';
import { projectMidiClipPlayback } from '../projectMidiClipPlayback';

function kick(startBeat: number, duration: number): MidiNote {
    return { id: 'kick', pitch: 36, startBeat, duration, velocity: 100 };
}

describe('projectMidiClipPlayback', () => {
    it('plays a looped third-of-a-beat kick that ends on the loop end once per pass, with no phantom hit', () => {
        const { notes } = projectMidiClipPlayback({
            notes: [kick(11 / 3, 1 / 3)],
            controlChanges: [],
            clip: { id: 'clip', startBeat: 4, endBeat: 12, loopEnabled: true, loopLength: 4 },
        });

        expect(notes).toHaveLength(2);
        expect(notes[0]?.startBeat).toBeCloseTo(4 + 11 / 3, 12);
        expect(notes[1]?.startBeat).toBeCloseTo(8 + 11 / 3, 12);
        expect(notes.every((played) => played.duration > SAME_BEAT_TOLERANCE)).toBe(true);
    });
});
