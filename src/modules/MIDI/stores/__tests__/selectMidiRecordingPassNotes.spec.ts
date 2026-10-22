import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { selectMidiRecordingPassNotes } from '../selectMidiRecordingPassNotes';

describe('selectMidiRecordingPassNotes', () => {
    const earlier: MidiNote = {
        id: 'earlier',
        recordingPassId: 'pass-1',
        pitch: 60,
        startBeat: 3,
        duration: 8,
        velocity: 100,
    };
    const selected: MidiNote = {
        id: 'selected',
        recordingPassId: 'pass-2',
        pitch: 72,
        startBeat: 5,
        duration: 5,
        velocity: 100,
        pressure: 10,
        pitchBend: 0,
        expression: {
            pressure: [
                { offsetBeats: 0.5, value: 30 },
                { offsetBeats: 2, value: 80 },
            ],
            pitchBend: [{ offsetBeats: 1.5, value: 100 }],
        },
    };

    it('keeps only the selected pass and slices its held tail with expression', () => {
        expect(
            selectMidiRecordingPassNotes([earlier, selected], {
                recordingPassId: 'pass-2',
                sourceStartBeat: 6,
                sourceEndBeat: 8,
            })
        ).toEqual([
            {
                ...selected,
                startBeat: 6,
                duration: 2,
                pressure: 30,
                pitchBend: 0,
                expression: {
                    pressure: [{ offsetBeats: 1, value: 80 }],
                    pitchBend: [{ offsetBeats: 0.5, value: 100 }],
                },
            },
        ]);
    });

    it('keeps the half-open source seam and legacy identity behavior', () => {
        const atEnd: MidiNote = {
            id: 'end',
            recordingPassId: 'pass-2',
            pitch: 72,
            startBeat: 8,
            duration: 0,
            velocity: 100,
        };
        const within: MidiNote = {
            id: 'within',
            recordingPassId: 'pass-2',
            pitch: 72,
            startBeat: 7,
            duration: 0,
            velocity: 100,
        };
        const notes = [earlier, within, atEnd];
        expect(
            selectMidiRecordingPassNotes(notes, {
                recordingPassId: 'pass-2',
                sourceStartBeat: 6,
                sourceEndBeat: 8,
            })
        ).toEqual([within]);
        expect(selectMidiRecordingPassNotes(notes, { sourceStartBeat: 6, sourceEndBeat: 8 })).toBe(notes);
    });
});
