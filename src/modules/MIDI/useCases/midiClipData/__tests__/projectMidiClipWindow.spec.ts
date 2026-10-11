import { describe, expect, it } from 'vitest';

import { type MidiCC, type MidiPitchBend } from '../../../models/MidiNote';
import { projectMidiClipWindow } from '../projectMidiClipWindow';

function controller(id: string, beat: number, value: number): MidiCC {
    return { id, controller: 64, value, beat, channel: 0 };
}

function bend(id: string, beat: number, value: number): MidiPitchBend {
    return { id, value, beat, channel: 0 };
}

describe('projectMidiClipWindow controller rows at the window end', () => {
    // The span of a clip from 2/3 to 2/3 + 4/3 is 4/3 and an ulp, so the window
    // end sits an ulp past the closing line a row is stored on.
    const length = 4 / 3;
    const clipStart = 2 / 3;
    const span = clipStart + length - clipStart;
    const window = { beatOffset: clipStart, visibleStartBeat: 0, visibleEndBeat: span };

    it('starts from a span that overshoots the closing line, which the cases below pin', () => {
        expect(span).toBeGreaterThan(length);
    });

    it('leaves a controller row and a pitch bend row on the closing line out of the window', () => {
        const projected = projectMidiClipWindow({
            notes: [],
            controlChanges: [controller('head', 0, 127), controller('closing', length, 0)],
            pitchBends: [bend('head', 0, 100), bend('closing', length, 0)],
            window,
        });

        expect(projected.controlChanges.map((row) => row.id)).toEqual(['head']);
        expect(projected.pitchBends.map((row) => row.id)).toEqual(['head']);
    });

    it('plays a controller row on the closing line where the window says its closing line plays, and drops a bend row there', () => {
        const projected = projectMidiClipWindow({
            notes: [],
            controlChanges: [
                controller('head', 0, 127),
                controller('closing', length, 0),
                controller('past', length + 1e-6, 64),
            ],
            pitchBends: [bend('head', 0, 100), bend('closing', length, 0)],
            window: { ...window, closingLineBeat: 2 },
        });

        expect(projected.controlChanges.map((row) => row.id)).toEqual(['head']);
        expect(projected.closingControlChanges.map(({ id, beat }) => [id, beat])).toEqual([['closing', 2]]);
        expect(projected.pitchBends.map((row) => row.id)).toEqual(['head']);
    });

    it('keeps a row that sits just inside the closing line', () => {
        const projected = projectMidiClipWindow({
            notes: [],
            controlChanges: [controller('head', 0, 127), controller('inside', length - 1e-6, 0)],
            pitchBends: [bend('head', 0, 100), bend('inside', length - 1e-6, 0)],
            window,
        });

        expect(projected.controlChanges.map((row) => row.id)).toEqual(['head', 'inside']);
        expect(projected.pitchBends.map((row) => row.id)).toEqual(['head', 'inside']);
    });
});
