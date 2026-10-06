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

/** Everything the instrument is told at the destination frame, in the order it is posted: the window's own events there, then the restore's moves. */
function sentAtDestination(lane: readonly MidiCC[], clip: Clip, atBeat: number): MidiCC[] {
    const restore = restoreAt(lane, clip, atBeat);
    const window = projectClipControllerEvents({
        controlChanges: lane,
        clip,
        fromBeat: atBeat,
        toBeat: atBeat + 1,
    }).filter((event) => frameOf(event.beat) === frameOf(atBeat));
    return [...window, ...restore.moves];
}

function laneOf(row: MidiCC): string {
    return `${row.channel}:${row.controller}`;
}

/**
 * The value each lane holds at the destination frame had playback run through the clip
 * to get there: the real projection stepped in abutting windows from a beat before the
 * clip, every event up to the destination frame applied in order.
 */
function valuesHeldByContinuousPlayback(lanes: readonly MidiCC[], clip: Clip, atBeat: number): Map<string, number> {
    const held = new Map<string, number>();
    const step = 0.75;
    const origin = clip.startBeat - 1;
    // One window past the destination: an event placed a rounding step after its beat sits on the destination's frame.
    for (let index = 0; origin + index * step <= atBeat + step; index++) {
        const window = projectClipControllerEvents({
            controlChanges: lanes,
            clip,
            fromBeat: origin + index * step,
            toBeat: origin + (index + 1) * step,
        });
        for (const event of window) {
            if (frameOf(event.beat) <= frameOf(atBeat)) {
                held.set(laneOf(event), event.value);
            }
        }
    }
    return held;
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

    it('carries the value an earlier pass left when the destination precedes the pass first row', () => {
        const lane = [controller('up', 1, 0), controller('down', 3, 127)];
        const clip = { startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 4 };

        // Pass 1's rows sit at 5 and 7, so at 4.5 the press from 3 in pass 0 is still held.
        expect(placed(restoreAt(lane, clip, 4.5).moves)).toEqual([{ controller: 64, beat: 4.5, value: 127 }]);
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

        it('carries the value the previous pass left at the head of a pass that carries none (start 1/3)', () => {
            // No row precedes a pass's visible span, so the projection places no carry on a head:
            // continuous playback keeps the press from 0.5 of the pass before.
            const clip = { startBeat: 1 / 3, endBeat: 1 / 3 + 8, loopEnabled: true, loopLength: 1 };
            const lane = [controller('late', 0.5, 127)];

            expect(sentAtDestination(lane, clip, 13 / 3).map((move) => move.value)).toEqual([127]);
            expect(restoreAt(lane, clip, 13 / 3).held).toEqual(new Set([64]));
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
        /** Sustain on channel 0 and a CC11 on channel 2: two lanes in one clip, each a row list. */
        const laneSets = [
            {
                sustainRows: [
                    { content: 0, value: 127 },
                    { content: 63, value: 0 },
                ],
                dynamicsRows: [
                    { content: 20, value: 33 },
                    { content: 70, value: 99 },
                ],
            },
            {
                sustainRows: [
                    { content: 10, value: 90 },
                    { content: 42, value: 127 },
                    { content: 83, value: 0 },
                    { content: 150, value: 64 },
                ],
                dynamicsRows: [{ content: 5, value: 12 }],
            },
        ];
        // No row sits on a pass's end (offset + loop length): whether the projection admits a row exactly
        // there is rounding, and the window's own answer is what plays.

        it('sends exactly the value continuous playback holds at every pass head, row and mid-pass destination', () => {
            let checked = 0;
            for (const startUnits of startNumerators) {
                for (const length of loopUnits) {
                    for (const offset of offsetUnits) {
                        for (const { sustainRows, dynamicsRows } of laneSets) {
                            const lanes = [
                                ...sustainRows.map((row, index) =>
                                    controller(`sustain-${index}`, toBeat(row.content), row.value)
                                ),
                                ...dynamicsRows.map((row, index) =>
                                    controller(`dynamics-${index}`, toBeat(row.content), row.value, 11, 2)
                                ),
                            ];
                            const clip = {
                                startBeat: toBeat(startUnits),
                                endBeat: toBeat(startUnits) + 3 * toBeat(length),
                                loopEnabled: true,
                                loopLength: toBeat(length),
                                midiOffsetBeats: toBeat(offset),
                            };
                            const contents = [
                                offset,
                                ...[...sustainRows, ...dynamicsRows].map((row) => row.content),
                                offset + 5,
                                offset + 11,
                            ].filter((content) => content >= offset && content < offset + length);
                            for (let pass = 0; pass < 3; pass++) {
                                for (const content of contents) {
                                    const destination = toBeat(startUnits + pass * length + (content - offset));
                                    const expected = valuesHeldByContinuousPlayback(lanes, clip, destination);

                                    const sent = new Map<string, number>();
                                    for (const move of sentAtDestination(lanes, clip, destination)) {
                                        sent.set(laneOf(move), move.value);
                                    }

                                    expect(
                                        sent,
                                        `start ${startUnits}/84 loop ${length}/84 offset ${offset}/84 pass ${pass} content ${content}`
                                    ).toEqual(expected);
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
