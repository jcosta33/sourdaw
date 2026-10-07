import { describe, expect, it } from 'vitest';

import { type MidiCC } from '../../../models/MidiNote';
import { projectClipControllerEvents } from '../projectClipControllerEvents';

function controller(id: string, beat: number, value: number, cc = 64, channel = 0): MidiCC {
    return { id, controller: cc, value, beat, channel };
}

function placed(events: readonly MidiCC[]): { beat: number; value: number }[] {
    return events.map((event) => ({ beat: event.beat, value: event.value }));
}

describe('projectClipControllerEvents', () => {
    it('begins a clip from the value in force at its content offset and places the moves past it', () => {
        // Clip at 4 plays content from beat 1, so content 0 (pedal down) is in force
        // when the clip starts and is carried to the clip start; content 2 and 3
        // land at 4 + (2 - 1) and 4 + (3 - 1).
        const events = projectClipControllerEvents({
            controlChanges: [controller('a', 0, 127), controller('b', 2, 0), controller('c', 3, 127)],
            clip: { startBeat: 4, endBeat: 8, midiOffsetBeats: 1 },
            fromBeat: 4,
            toBeat: 8,
        });

        expect(placed(events)).toEqual([
            { beat: 4, value: 127 },
            { beat: 5, value: 0 },
            { beat: 6, value: 127 },
        ]);
    });

    it('repeats a looped clip moves at each iteration start plus the content beat', () => {
        const events = projectClipControllerEvents({
            controlChanges: [controller('a', 0.5, 127), controller('b', 1.5, 0)],
            clip: { startBeat: 4, endBeat: 8, midiOffsetBeats: 0, loopEnabled: true, loopLength: 2 },
            fromBeat: 4,
            toBeat: 8,
        });

        expect(placed(events)).toEqual([
            { beat: 4.5, value: 127 },
            { beat: 5.5, value: 0 },
            { beat: 6.5, value: 127 },
            { beat: 7.5, value: 0 },
        ]);
    });

    it('starts every loop pass from the value in force at the pass head', () => {
        // Visible content is [1, 3). The pedal went down at content 0, before the
        // visible span, so each pass opens with it down and then replays its own moves.
        const events = projectClipControllerEvents({
            controlChanges: [controller('a', 0, 127), controller('b', 1.5, 0), controller('c', 2.5, 127)],
            clip: { startBeat: 4, endBeat: 8, midiOffsetBeats: 1, loopEnabled: true, loopLength: 2 },
            fromBeat: 4,
            toBeat: 8,
        });

        expect(placed(events)).toEqual([
            { beat: 4, value: 127 },
            { beat: 4.5, value: 0 },
            { beat: 5.5, value: 127 },
            { beat: 6, value: 127 },
            { beat: 6.5, value: 0 },
            { beat: 7.5, value: 127 },
        ]);
    });

    it('emits each move once across the two windows either side of a transport loop seam', () => {
        const controlChanges = [controller('late', 3.75, 127), controller('early', 0.25, 0)];
        const clip = { startBeat: 0, endBeat: 4 };

        const beforeSeam = projectClipControllerEvents({ controlChanges, clip, fromBeat: 3.5, toBeat: 4 });
        const afterSeam = projectClipControllerEvents({ controlChanges, clip, fromBeat: 0, toBeat: 0.5 });

        expect(beforeSeam.map((event) => event.id)).toEqual(['late']);
        expect(afterSeam.map((event) => event.id)).toEqual(['early']);
    });

    it('owns a move on a window boundary in the window that opens at it', () => {
        const controlChanges = [controller('on-boundary', 4, 127)];
        const clip = { startBeat: 0, endBeat: 8 };

        expect(projectClipControllerEvents({ controlChanges, clip, fromBeat: 0, toBeat: 4 })).toEqual([]);
        expect(
            projectClipControllerEvents({ controlChanges, clip, fromBeat: 4, toBeat: 8 }).map((event) => event.id)
        ).toEqual(['on-boundary']);
    });

    it('leaves the carry at a window opening mid-clip to the transport', () => {
        const events = projectClipControllerEvents({
            controlChanges: [controller('a', 0, 127)],
            clip: { startBeat: 0, endBeat: 8 },
            fromBeat: 4,
            toBeat: 8,
        });

        expect(events).toEqual([]);
    });

    it('carries each controller lane on each channel independently', () => {
        const events = projectClipControllerEvents({
            controlChanges: [
                controller('sustain', 0, 127, 64),
                controller('wheel', 0, 30, 1),
                controller('other-channel', 0, 90, 64, 1),
                controller('later', 2, 0, 64),
            ],
            clip: { startBeat: 4, endBeat: 8, midiOffsetBeats: 1 },
            fromBeat: 4,
            toBeat: 8,
        });

        expect(
            events.map((event) => ({
                beat: event.beat,
                controller: event.controller,
                channel: event.channel,
                value: event.value,
            }))
        ).toEqual([
            { beat: 4, controller: 64, channel: 0, value: 127 },
            { beat: 4, controller: 1, channel: 0, value: 30 },
            { beat: 4, controller: 64, channel: 1, value: 90 },
            { beat: 5, controller: 64, channel: 0, value: 0 },
        ]);
    });

    it('drops moves at or past the clip end and returns nothing for an empty lane', () => {
        expect(
            projectClipControllerEvents({
                controlChanges: [controller('past-end', 4, 127)],
                clip: { startBeat: 0, endBeat: 4 },
                fromBeat: 0,
                toBeat: 8,
            })
        ).toEqual([]);
        expect(
            projectClipControllerEvents({
                controlChanges: [],
                clip: { startBeat: 0, endBeat: 4 },
                fromBeat: 0,
                toBeat: 4,
            })
        ).toEqual([]);
    });
});
