import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../../../models/SameBeatTolerance';
import { projectMidiClipPlayback } from '../projectMidiClipPlayback';

function kick(startBeat: number, duration: number): MidiNote {
    return { id: 'kick', pitch: 36, startBeat, duration, velocity: 100 };
}

describe('projectMidiClipPlayback', () => {
    it('plays a sustain lift on the clip closing line on the clip end, but no note that starts there', () => {
        const played = projectMidiClipPlayback({
            notes: [kick(0, 4), kick(4, 1)],
            controlChanges: [
                { id: 'down', controller: 64, value: 127, beat: 0, channel: 0 },
                { id: 'lift', controller: 64, value: 0, beat: 4, channel: 0 },
            ],
            clip: { id: 'clip', startBeat: 1, endBeat: 5 },
        });

        expect(played.notes.map(({ startBeat, duration }) => [startBeat, duration])).toEqual([[1, 4]]);
        expect(played.controlChanges).toEqual([
            { id: 'down', controller: 64, value: 127, beat: 1, channel: 0 },
            { id: 'lift', controller: 64, value: 0, beat: 5, channel: 0 },
        ]);
    });

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

    it('plays a note once per pass when a trim leaves its start a float residue below a loop length', () => {
        // trimClipStart stores 10/3 - 8/3 as the content offset of a clip trimmed from 8/3 to 10/3.
        const { notes } = projectMidiClipPlayback({
            notes: [kick(2 / 3, 1 / 3)],
            controlChanges: [],
            clip: {
                id: 'clip',
                startBeat: 10 / 3,
                endBeat: 10 / 3 + 8,
                loopEnabled: true,
                loopLength: 4,
                midiOffsetBeats: 10 / 3 - 8 / 3,
            },
        });

        expect(notes).toHaveLength(2);
        expect(notes[0]?.startBeat).toBeCloseTo(10 / 3, 12);
        expect(notes[1]?.startBeat).toBeCloseTo(10 / 3 + 4, 12);
        expect(notes.every((played) => played.duration > SAME_BEAT_TOLERANCE)).toBe(true);
    });

    it('still starts a note that begins a real 1e-6 beats before the loop end there and wraps its tail', () => {
        const { notes } = projectMidiClipPlayback({
            notes: [kick(4 - 1e-6, 0.5)],
            controlChanges: [],
            clip: { id: 'clip', startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 4 },
        });

        const [firstTail, firstHead, secondTail, secondHead] = notes;
        expect(notes).toHaveLength(4);
        expect(firstTail?.startBeat).toBe(0);
        expect(firstTail?.duration).toBeCloseTo(0.5 - 1e-6, 12);
        expect(firstHead?.startBeat).toBeCloseTo(4 - 1e-6, 12);
        expect(firstHead?.duration).toBeCloseTo(1e-6, 12);
        expect(secondTail?.startBeat).toBe(4);
        expect(secondHead?.startBeat).toBeCloseTo(8 - 1e-6, 12);
    });

    describe.each([3, 5, 6, 7, 10, 12])('a looped clip trimmed on a grid of %i steps per beat', (division) => {
        const LOOP_LENGTHS = [4, 10 / 3, 3.75, 2.4, 1];
        const PASSES = 3;
        const MICRO = 1e6;

        function microBeats(beats: number): number {
            return Math.round(beats * MICRO);
        }

        it.each(LOOP_LENGTHS)(
            'plays every note once per pass with no residue segment for a loop of %d beats',
            (loopLength) => {
                const loopMicro = microBeats(loopLength);
                const noteSteps = Array.from({ length: Math.ceil(loopLength * division) * 2 }, (_, step) => step);
                // One pitch per note, so a segment is attributed to its note by pitch.
                const stored = noteSteps.map((step): MidiNote => ({
                    id: `note-${step}`,
                    pitch: 20 + step,
                    startBeat: step / division,
                    duration: 1 / division,
                    velocity: 100,
                }));
                const trims = [1, 2, 3, 5, 7].map((trimSteps) => ({
                    clipStart: (division + trimSteps) / division,
                    offset: (division + trimSteps) / division - 1,
                }));

                for (const { clipStart, offset } of trims) {
                    const { notes: played } = projectMidiClipPlayback({
                        notes: stored,
                        controlChanges: [],
                        clip: {
                            id: 'clip',
                            startBeat: clipStart,
                            endBeat: clipStart + PASSES * loopLength,
                            loopEnabled: true,
                            loopLength,
                            midiOffsetBeats: offset,
                        },
                    });

                    expect(played.every((segment) => segment.duration > SAME_BEAT_TOLERANCE)).toBe(true);

                    for (const note of stored) {
                        const relativeMicro = microBeats(note.startBeat - offset);
                        if (relativeMicro >= loopMicro) {
                            continue;
                        }
                        const headOffset = (((relativeMicro % loopMicro) + loopMicro) % loopMicro) / MICRO;
                        for (let pass = 0; pass < PASSES; pass++) {
                            const headBeat = clipStart + pass * loopLength + headOffset;
                            const heads = played.filter(
                                (segment) =>
                                    segment.pitch === note.pitch && Math.abs(segment.startBeat - headBeat) < 1e-6
                            );
                            expect(heads, `pass ${pass} of the note at ${note.startBeat}`).toHaveLength(1);
                        }
                    }
                }
            }
        );
    });
});
