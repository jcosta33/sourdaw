import { describe, expect, it } from 'vitest';

import { type MidiCC } from '../../../models/MidiNote';
import { projectClipControllerEvents } from '../projectClipControllerEvents';
import { projectClipControllerRestore } from '../projectClipControllerRestore';

function controller(id: string, beat: number, value: number, cc = 64, channel = 0): MidiCC {
    return { id, controller: cc, value, beat, channel };
}

/** 120 BPM at 48 kHz: the sample frame a beat is posted at. */
const FRAMES_PER_BEAT = 24_000;
const frameOf = (beat: number) => Math.round(beat * FRAMES_PER_BEAT);

type Clip = Parameters<typeof projectClipControllerEvents>[0]['clip'];

/** The restore for a relocation to `atBeat` whose window runs one beat on. */
function restoreAt(lane: readonly MidiCC[], clip: Clip, atBeat: number) {
    return projectClipControllerRestore({
        controlChanges: lane,
        clip,
        atBeat,
        windowToBeat: atBeat + 1,
        onDestinationFrame: (beat) => frameOf(beat) === frameOf(atBeat),
    });
}

/** Everything the instrument is told at the destination frame: the restore's moves and the window's own events there. */
function sentAtDestination(lane: readonly MidiCC[], clip: Clip, atBeat: number): MidiCC[] {
    const restore = restoreAt(lane, clip, atBeat);
    const window = projectClipControllerEvents({
        controlChanges: lane,
        clip,
        fromBeat: atBeat,
        toBeat: atBeat + 1,
    }).filter((event) => frameOf(event.beat) === frameOf(atBeat));
    return [...restore.moves, ...window];
}

function placed(moves: readonly MidiCC[]): { controller: number; beat: number; value: number }[] {
    return moves.map(({ controller: cc, beat, value }) => ({ controller: cc, beat, value }));
}

/** A pedal that is up at the head, down at 3.5 and up again at 6, over an 8-beat clip. */
const pedalLane = [controller('up-0', 0, 0), controller('down', 3.5, 127), controller('up-6', 6, 0)];
const eightBeatClip = { startBeat: 0, endBeat: 8 };

describe('projectClipControllerRestore', () => {
    it('sends the value in force at a destination inside the clip', () => {
        expect(placed(restoreAt(pedalLane, eightBeatClip, 2).moves)).toEqual([{ controller: 64, beat: 2, value: 0 }]);
        expect(placed(restoreAt(pedalLane, eightBeatClip, 4).moves)).toEqual([{ controller: 64, beat: 4, value: 127 }]);
        expect(placed(restoreAt(pedalLane, eightBeatClip, 7).moves)).toEqual([{ controller: 64, beat: 7, value: 0 }]);
    });

    it('leaves a lane with a row on the destination to the window that opens there', () => {
        const restore = restoreAt(pedalLane, eightBeatClip, 3.5);

        expect(restore.moves).toEqual([]);
        expect(restore.held).toEqual(new Set([64]));
    });

    it('takes the later source row when two rows of a lane share the beat before the destination', () => {
        const lane = [controller('first', 1, 127), controller('second', 1, 0)];

        expect(placed(restoreAt(lane, eightBeatClip, 2).moves)).toEqual([{ controller: 64, beat: 2, value: 0 }]);
    });

    it('keeps each controller and channel a lane of its own', () => {
        const lane = [
            controller('sustain', 0, 127),
            controller('sostenuto', 1, 64, 66),
            controller('other-channel', 1.5, 90, 64, 3),
        ];

        const restore = restoreAt(lane, eightBeatClip, 2);

        expect(placed(restore.moves)).toEqual(
            expect.arrayContaining([
                { controller: 64, beat: 2, value: 127 },
                { controller: 66, beat: 2, value: 64 },
                { controller: 64, beat: 2, value: 90 },
            ])
        );
        expect(restore.moves).toHaveLength(3);
        expect(restore.held).toEqual(new Set([64, 66]));
    });

    it('sends nothing for a lane that has no row before the destination', () => {
        expect(restoreAt([controller('late', 5, 127)], eightBeatClip, 2)).toEqual({ moves: [], held: new Set() });
    });

    it('reads the value in force within the loop pass the destination falls in', () => {
        const lane = [controller('down', 1, 127), controller('up', 3, 0)];
        const clip = { startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 4 };

        expect(placed(restoreAt(lane, clip, 6).moves)).toEqual([{ controller: 64, beat: 6, value: 127 }]);
        expect(placed(restoreAt(lane, clip, 7.5).moves)).toEqual([{ controller: 64, beat: 7.5, value: 0 }]);
    });

    it('reads the value in force past the clip content offset', () => {
        const clip = { startBeat: 4, endBeat: 8, midiOffsetBeats: 1 };

        expect(placed(restoreAt([controller('held', 0.5, 127)], clip, 5).moves)).toEqual([
            { controller: 64, beat: 5, value: 127 },
        ]);
    });

    it('leaves a pass head to the window that carries it, and still names what the head holds', () => {
        const clip = { startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 4, midiOffsetBeats: 1 };

        const onSecondHead = restoreAt([controller('held', 0.5, 127)], clip, 4);

        expect(onSecondHead.moves).toEqual([]);
        expect(onSecondHead.held).toEqual(new Set([64]));
    });

    it('sends nothing for a destination outside the clip', () => {
        expect(restoreAt(pedalLane, { startBeat: 4, endBeat: 8 }, 2)).toEqual({ moves: [], held: new Set() });
        expect(restoreAt(pedalLane, eightBeatClip, 8)).toEqual({ moves: [], held: new Set() });
    });

    describe('where the clip beats are not dyadic fractions', () => {
        it('ends a jump onto a pass head of a one-beat loop on the head carry (start 1/3)', () => {
            const clip = { startBeat: 1 / 3, endBeat: 1 / 3 + 8, loopEnabled: true, loopLength: 1 };
            const lane = [controller('down', 0, 127), controller('up', 0.75, 0)];

            const sent = sentAtDestination(lane, clip, 13 / 3);

            expect(sent.map((move) => move.value)).toEqual([127]);
        });

        it('sends nothing at the head of a pass whose lane has no row in force yet (start 1/3)', () => {
            const clip = { startBeat: 1 / 3, endBeat: 1 / 3 + 8, loopEnabled: true, loopLength: 1 };
            const lane = [controller('late', 0.5, 127)];

            expect(sentAtDestination(lane, clip, 13 / 3)).toEqual([]);
            expect(restoreAt(lane, clip, 13 / 3).held).toEqual(new Set());
        });

        it('ends on the row at the destination, not the press carried from before it (offset 1/3)', () => {
            const clip = { startBeat: 1, endBeat: 9, midiOffsetBeats: 1 / 3 };
            const lane = [controller('down', 1, 127), controller('up', 2, 0)];

            expect(sentAtDestination(lane, clip, 8 / 3).map((move) => move.value)).toEqual([0]);
        });

        it('ends on the row at the destination for the 7/6 + 1/6 clip', () => {
            const clip = { startBeat: 7 / 6, endBeat: 7 / 6 + 8, midiOffsetBeats: 1 / 6 };
            const lane = [controller('down', 1, 127), controller('up', 3, 0)];

            const sent = sentAtDestination(lane, clip, 4);

            expect(sent.map((move) => move.value)).toEqual([0]);
            expect(restoreAt(lane, clip, 4).held).toEqual(new Set([64]));
        });

        it('carries the value in force when the next row is a fraction of a beat after the destination', () => {
            // The lift at 2.0001 is 2.4 frames later: it is the window's to send in its time, and the
            // press carried from before is what is in force at 2.
            const lane = [controller('down', 1, 127), controller('up', 2.0001, 0)];

            const restore = restoreAt(lane, eightBeatClip, 2);

            expect(placed(restore.moves)).toEqual([{ controller: 64, beat: 2, value: 127 }]);
        });
    });

    describe('against the exact value in force, over clip starts, loop lengths and destinations', () => {
        /** Everything is a whole number of 1/84 beats, so the exact answer is integer arithmetic. */
        const UNITS_PER_BEAT = 84;
        const toBeat = (units: number) => units / UNITS_PER_BEAT;
        const startNumerators = [
            ...[1, 2, 3, 4, 5, 6, 7].map((numerator) => (numerator * UNITS_PER_BEAT) / 3),
            ...[1, 5, 7, 11].map((numerator) => (numerator * UNITS_PER_BEAT) / 6),
            ...[1, 2, 3, 6].map((numerator) => (numerator * UNITS_PER_BEAT) / 7),
            ...[1, 5, 7, 11].map((numerator) => (numerator * UNITS_PER_BEAT) / 12),
        ];
        const loopUnits = [84, 168, 112];
        const offsetUnits = [0, 14, 28];
        const rowSets = [
            [
                { content: 0, value: 127 },
                { content: 63, value: 0 },
            ],
            [
                { content: 10, value: 90 },
                { content: 42, value: 127 },
                { content: 83, value: 0 },
                { content: 150, value: 64 },
            ],
        ];
        // No row sits on a pass's end (offset + loop length): whether the projection admits a row exactly
        // there is rounding, and the window's own answer is what plays.

        it('sends exactly the value in force at every pass head and row placement', () => {
            let checked = 0;
            for (const startUnits of startNumerators) {
                for (const length of loopUnits) {
                    for (const offset of offsetUnits) {
                        for (const rows of rowSets) {
                            const lane = rows.map((row, index) =>
                                controller(`row-${index}`, toBeat(row.content), row.value)
                            );
                            const clip = {
                                startBeat: toBeat(startUnits),
                                endBeat: toBeat(startUnits) + 3 * toBeat(length),
                                loopEnabled: true,
                                loopLength: toBeat(length),
                                midiOffsetBeats: toBeat(offset),
                            };
                            const contents = [offset, ...rows.map((row) => row.content)].filter(
                                (content) => content >= offset && content < offset + length
                            );
                            for (let pass = 0; pass < 3; pass++) {
                                for (const content of contents) {
                                    const destinationUnits = startUnits + pass * length + (content - offset);
                                    const inForce = rows.findLast((row) => row.content <= content)?.value;

                                    const sent = sentAtDestination(lane, clip, toBeat(destinationUnits));

                                    expect(
                                        sent.at(-1)?.value,
                                        `start ${startUnits}/84 loop ${length}/84 offset ${offset}/84 pass ${pass} content ${content}`
                                    ).toBe(inForce);
                                    checked++;
                                }
                            }
                        }
                    }
                }
            }
            expect(checked).toBeGreaterThan(2_000);
        });
    });
});
