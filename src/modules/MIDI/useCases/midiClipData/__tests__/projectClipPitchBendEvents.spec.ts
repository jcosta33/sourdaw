import { describe, expect, it } from 'vitest';

import { type MidiPitchBend } from '../../../models/MidiNote';
import { projectClipPitchBendEvents } from '../projectClipPitchBendEvents';

function bend(id: string, beat: number, value: number, channel = 0): MidiPitchBend {
    return { id, beat, value, channel };
}

function placed(events: readonly MidiPitchBend[]): { beat: number; value: number }[] {
    return events.map((event) => ({ beat: event.beat, value: event.value }));
}

describe('projectClipPitchBendEvents', () => {
    it('places a move where a note at that content beat is, past the clip start and the content offset', () => {
        // The clip at 4 plays content from beat 1, so the bend out at content 0 is in force
        // when it starts and sits on the clip start; content 2 and 3 land at 5 and 6.
        const events = projectClipPitchBendEvents({
            pitchBends: [bend('a', 0, 8_191), bend('b', 2, 0), bend('c', 3, -4_096)],
            clip: { startBeat: 4, endBeat: 8, midiOffsetBeats: 1 },
            fromBeat: 4,
            toBeat: 8,
        });

        expect(placed(events)).toEqual([
            { beat: 4, value: 8_191 },
            { beat: 5, value: 0 },
            { beat: 6, value: -4_096 },
        ]);
        expect(events.map((event) => event.contentBeat)).toEqual([1, 2, 3]);
    });

    it('begins every loop pass from the bend in force at its head', () => {
        const events = projectClipPitchBendEvents({
            pitchBends: [bend('a', 0, 8_191), bend('b', 1.5, 0)],
            clip: { startBeat: 4, endBeat: 8, midiOffsetBeats: 1, loopEnabled: true, loopLength: 2 },
            fromBeat: 4,
            toBeat: 8,
        });

        // Visible content is [1, 3): each pass opens with the bend out carried to its head, then replays its own return.
        expect(placed(events)).toEqual([
            { beat: 4, value: 8_191 },
            { beat: 4.5, value: 0 },
            { beat: 6, value: 8_191 },
            { beat: 6.5, value: 0 },
        ]);
    });

    it('says where each move was recorded on the pass that plays it, before the pass head for a carry', () => {
        // The clip at 4 plays content [1, 3) on each two-beat pass: the bend out at content 0 is carried onto
        // both heads, recorded a beat before each, and the return at content 1.5 is played where it was recorded.
        const events = projectClipPitchBendEvents({
            pitchBends: [bend('a', 0, 8_191), bend('b', 1.5, 0)],
            clip: { startBeat: 4, endBeat: 8, midiOffsetBeats: 1, loopEnabled: true, loopLength: 2 },
            fromBeat: 4,
            toBeat: 8,
        });

        expect(events.map((event) => [event.beat, event.recordedBeat])).toEqual([
            [4, 3],
            [4.5, 4.5],
            [6, 5],
            [6.5, 6.5],
        ]);
        // The row's own content beat travels with the move, so a caller can read state where it was recorded.
        expect(events.map((event) => [event.contentBeat, event.recordedContentBeat])).toEqual([
            [1, 0],
            [1.5, 1.5],
            [1, 0],
            [1.5, 1.5],
        ]);
    });

    it('carries the bend of each channel on its own', () => {
        const events = projectClipPitchBendEvents({
            pitchBends: [bend('a', 0, 100, 0), bend('b', 0.5, 200, 1), bend('c', 1, 300, 0)],
            clip: { startBeat: 0, endBeat: 8, midiOffsetBeats: 2 },
            fromBeat: 0,
            toBeat: 8,
        });

        expect(events.map((event) => [event.channel, event.beat, event.value])).toEqual([
            [0, 0, 300],
            [1, 0, 200],
        ]);
    });

    it('owns a move in the one window that holds it across a transport loop seam', () => {
        const pitchBends = [bend('late', 3.75, 8_191), bend('early', 0.25, 0)];
        const clip = { startBeat: 0, endBeat: 4 };

        const beforeSeam = projectClipPitchBendEvents({ pitchBends, clip, fromBeat: 3.5, toBeat: 4 });
        const afterSeam = projectClipPitchBendEvents({ pitchBends, clip, fromBeat: 0, toBeat: 0.5 });

        expect(beforeSeam.map((event) => event.id)).toEqual(['late']);
        expect(afterSeam.map((event) => event.id)).toEqual(['early']);
    });

    it('leaves the carry of a window opening mid-clip to the caller, which reads the window up to its start', () => {
        const pitchBends = [bend('a', 1, 8_191)];
        const clip = { startBeat: 0, endBeat: 8 };

        expect(projectClipPitchBendEvents({ pitchBends, clip, fromBeat: 2, toBeat: 4 })).toEqual([]);
        expect(
            placed(projectClipPitchBendEvents({ pitchBends, clip, fromBeat: Number.NEGATIVE_INFINITY, toBeat: 2 }))
        ).toEqual([{ beat: 1, value: 8_191 }]);
    });

    it('drops a row on the clip end or past it, whatever its value, because bend has no closing line', () => {
        const events = projectClipPitchBendEvents({
            pitchBends: [bend('in', 3, 8_191), bend('on-end', 4, 0), bend('past', 5, 0)],
            clip: { startBeat: 0, endBeat: 4 },
            fromBeat: Number.NEGATIVE_INFINITY,
            toBeat: Number.POSITIVE_INFINITY,
        });

        expect(events.map((event) => event.id)).toEqual(['in']);
    });

    it('lists the moves in beat order whatever order the rows are stored in', () => {
        const events = projectClipPitchBendEvents({
            pitchBends: [bend('late', 3, 100), bend('early', 1, 200)],
            clip: { startBeat: 0, endBeat: 4 },
            fromBeat: 0,
            toBeat: 4,
        });

        expect(events.map((event) => event.id)).toEqual(['early', 'late']);
    });

    it('returns nothing for an empty lane', () => {
        expect(
            projectClipPitchBendEvents({ pitchBends: [], clip: { startBeat: 0, endBeat: 4 }, fromBeat: 0, toBeat: 4 })
        ).toEqual([]);
    });
});
