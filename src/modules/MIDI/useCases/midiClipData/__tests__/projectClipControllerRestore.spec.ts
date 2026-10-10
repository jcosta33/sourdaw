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

type TrackClip = { clip: Clip; controlChanges: readonly MidiCC[] };

/** The restore for a relocation to `atBeat` whose window runs one beat on, over every clip of a track. */
function restoreTrackAt(clips: readonly TrackClip[], atBeat: number) {
    return projectClipControllerRestore({
        clips,
        atBeat,
        windowToBeat: atBeat + 1,
        sampleFrameAtBeat: frameOf,
    });
}

function restoreAt(lane: readonly MidiCC[], clip: Clip, atBeat: number) {
    return restoreTrackAt([{ clip, controlChanges: lane }], atBeat);
}

/** Where a move sits among the controllers of its frame: a closing-line move first, as the same-frame queue posts it. */
const sameFrameRank = (move: { closesClip: boolean }) => (move.closesClip ? 0 : 1);

/** Everything the instrument is told at the destination frame, in the order it is posted: the window's own events there (closing-line moves first, then clip by clip), then the restore's moves. */
function sentTrackAtDestination(clips: readonly TrackClip[], atBeat: number): MidiCC[] {
    const restore = restoreTrackAt(clips, atBeat);
    const window = clips
        .flatMap(({ clip, controlChanges }) =>
            projectClipControllerEvents({
                controlChanges,
                clip,
                fromBeat: atBeat,
                toBeat: atBeat + 1,
            }).filter((event) => frameOf(event.beat) === frameOf(atBeat))
        )
        .sort((left, right) => sameFrameRank(left) - sameFrameRank(right));
    return [...window, ...restore.moves];
}

function sentAtDestination(lane: readonly MidiCC[], clip: Clip, atBeat: number): MidiCC[] {
    return sentTrackAtDestination([{ clip, controlChanges: lane }], atBeat);
}

/** The instruments hold one value per controller number: the channel a row names is dropped. */
function laneOf(row: MidiCC): string {
    return String(row.controller);
}

/**
 * The value each controller holds at the destination frame had playback run through the track
 * to get there: each clip's real projection stepped in abutting windows from a beat before the
 * track's first clip, every event up to the destination frame posted as the window's same-frame
 * queue posts a window's controllers (by sample frame, then a closing-line move ahead of the
 * others, then the order they were added: clip sequence, then each clip's row order) and applied
 * in that order. The whole history is one
 * window, because two moves a rounding step apart in beat share a frame and the window that
 * posts them decides nothing the clip order does not.
 */
function valuesHeldByContinuousPlayback(clips: readonly TrackClip[], atBeat: number): Map<string, number> {
    const posts: { frame: number; rank: number; sequence: number; event: MidiCC }[] = [];
    const step = 0.75;
    const origin = Math.min(...clips.map(({ clip }) => clip.startBeat)) - 1;
    for (const { clip, controlChanges } of clips) {
        // One window past the destination: an event placed a rounding step after its beat sits on the destination's frame.
        for (let index = 0; origin + index * step <= atBeat + step; index++) {
            const window = projectClipControllerEvents({
                controlChanges,
                clip,
                fromBeat: origin + index * step,
                toBeat: origin + (index + 1) * step,
            });
            for (const event of window) {
                if (frameOf(event.beat) <= frameOf(atBeat)) {
                    posts.push({
                        frame: frameOf(event.beat),
                        rank: sameFrameRank(event),
                        sequence: posts.length,
                        event,
                    });
                }
            }
        }
    }
    const held = new Map<string, number>();
    for (const post of posts.sort(
        (left, right) => left.frame - right.frame || left.rank - right.rank || left.sequence - right.sequence
    )) {
        held.set(laneOf(post.event), post.event.value);
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

    it('keeps each controller number a lane of its own, whatever its channel', () => {
        const lane = [
            controller('sustain', 0, 127),
            controller('sostenuto', 1, 64, 66),
            controller('other-channel', 1.5, 90, 64, 3),
        ];

        const restore = restoreAt(lane, eightBeatClip, 2);

        expect(placed(restore.moves)).toEqual(
            expect.arrayContaining([
                { controller: 64, beat: 2, value: 90 },
                { controller: 66, beat: 2, value: 64 },
            ])
        );
        expect(restore.moves).toHaveLength(2);
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

    it('sends nothing from a clip that starts after the destination', () => {
        expect(restoreAt(pedalLane, { startBeat: 4, endBeat: 8 }, 2)).toEqual({ moves: [], held: new Set() });
    });

    it('carries what a clip that ended before the destination left', () => {
        expect(placed(restoreAt(pedalLane, eightBeatClip, 8).moves)).toEqual([{ controller: 64, beat: 8, value: 0 }]);
    });

    describe('across the clips of a track', () => {
        const clipA = { startBeat: 0, endBeat: 4 };
        const clipB = { startBeat: 4, endBeat: 8 };

        it('keeps a pedal a clip left down through a later clip that has no row for it', () => {
            const clips = [
                { clip: clipA, controlChanges: [controller('down', 1, 127)] },
                { clip: clipB, controlChanges: [controller('other', 0.5, 90, 11)] },
            ];

            const restore = restoreTrackAt(clips, 5);

            expect(placed(restore.moves)).toEqual(
                expect.arrayContaining([
                    { controller: 64, beat: 5, value: 127 },
                    { controller: 11, beat: 5, value: 90 },
                ])
            );
            expect(restore.held).toEqual(new Set([64, 11]));
        });

        it('takes the later clip row when it falls between the earlier clip row and the destination', () => {
            const clips = [
                { clip: clipA, controlChanges: [controller('down', 1, 127)] },
                { clip: clipB, controlChanges: [controller('up', 0.5, 0)] },
            ];

            expect(placed(restoreTrackAt(clips, 5).moves)).toEqual([{ controller: 64, beat: 5, value: 0 }]);
        });

        it('keeps the later row by beat, however the clips are ordered', () => {
            // The row of the clip that is listed later sits earlier on the timeline.
            const clips = [
                { clip: clipB, controlChanges: [controller('up', 0.5, 0)] },
                { clip: clipA, controlChanges: [controller('down', 1, 127)] },
            ];

            expect(placed(restoreTrackAt(clips, 5).moves)).toEqual([{ controller: 64, beat: 5, value: 0 }]);
        });

        it('takes the later clip when two rows are placed on one beat', () => {
            const overlapping = { startBeat: 0, endBeat: 4 };
            const clips = [
                { clip: clipA, controlChanges: [controller('first', 2, 127)] },
                { clip: overlapping, controlChanges: [controller('second', 2, 0)] },
            ];

            expect(placed(restoreTrackAt(clips, 3).moves)).toEqual([{ controller: 64, beat: 3, value: 0 }]);
        });

        it('orders two moves a rounding step apart by sample frame and clip, not by beat', () => {
            // Clip 2's row lands on timeline beat 1.9999999999999998, a step before clip 1's row at 2: one
            // sample frame, so the later clip is the last word, as the window posts them.
            const clips = [
                { clip: { startBeat: 0, endBeat: 4 }, controlChanges: [controller('first', 2, 127)] },
                {
                    clip: { startBeat: 0.3, endBeat: 4, midiOffsetBeats: 0.6 },
                    controlChanges: [controller('second', 2.3, 0)],
                },
            ];

            expect(placed(restoreTrackAt(clips, 3).moves)).toEqual([{ controller: 64, beat: 3, value: 0 }]);
        });

        it('lets a move from before the destination that lands on its frame outrank the window of an earlier clip', () => {
            // Clip 2's row is a step before the destination yet on its frame; clip 1's row sits on the
            // destination. The restore posts after the window, and clip 2 is the later clip.
            const clips = [
                { clip: { startBeat: 0, endBeat: 4 }, controlChanges: [controller('window', 3, 0)] },
                {
                    clip: { startBeat: 0.3, endBeat: 4, midiOffsetBeats: 0.6 },
                    controlChanges: [controller('history', 3.3, 127)],
                },
            ];

            const sent = sentTrackAtDestination(clips, 3);

            expect(sent.map((move) => move.value)).toEqual([0, 127]);
            expect(restoreTrackAt(clips, 3).held).toEqual(new Set([64]));
        });

        describe('with a pedal lift stored on the closing line of the clip before', () => {
            const liftedA = { clip: clipA, controlChanges: [controller('down', 0, 127), controller('lift', 4, 0)] };

            it('sends the pedal up inside a following clip that has no pedal row', () => {
                const clips = [liftedA, { clip: clipB, controlChanges: [controller('other', 0.5, 90, 11)] }];

                expect(placed(restoreTrackAt(clips, 6).moves)).toEqual(
                    expect.arrayContaining([{ controller: 64, beat: 6, value: 0 }])
                );
            });

            it('sends the lift on a destination exactly on the clip end, which the window opening there does not schedule', () => {
                const clips = [liftedA, { clip: clipB, controlChanges: [controller('other', 0.5, 90, 11)] }];

                const restore = restoreTrackAt(clips, 4);

                expect(placed(restore.moves)).toEqual([{ controller: 64, beat: 4, value: 0 }]);
                expect(sentTrackAtDestination(clips, 4).map((move) => move.value)).toEqual([0]);
            });

            it.each([
                ['the ending clip listed first', [0, 1]],
                ['the starting clip listed first', [1, 0]],
            ])('lets the head of the clip that starts on the clip end have the last word (%s)', (_order, order) => {
                const pair = [liftedA, { clip: clipB, controlChanges: [controller('press', 0, 127)] }];
                const clips = order.map((index) => pair[index]!);

                expect(placed(restoreTrackAt(clips, 6).moves)).toEqual([{ controller: 64, beat: 6, value: 127 }]);
                // A relocation onto the clip end gives the pedal the value in force there, the head's press,
                // and never lifts it first.
                expect(sentTrackAtDestination(clips, 4).map((move) => move.value)).toEqual([127]);
            });
        });

        it('leaves a controller a later clip emits on the destination frame to the window', () => {
            const clips = [
                { clip: clipA, controlChanges: [controller('down', 1, 127)] },
                { clip: clipB, controlChanges: [controller('up-on-destination', 1, 0)] },
            ];

            const restore = restoreTrackAt(clips, 5);

            expect(restore.moves).toEqual([]);
            expect(restore.held).toEqual(new Set([64]));
        });
    });

    describe('where a controller is one value across the channels', () => {
        it('leaves a controller to the window when a row on another channel sits on the destination frame', () => {
            const lane = [controller('down', 1, 127), controller('up-on-destination', 2, 0, 64, 1)];

            const restore = restoreAt(lane, eightBeatClip, 2);

            expect(restore.moves).toEqual([]);
            expect(restore.held).toEqual(new Set([64]));
            expect(sentAtDestination(lane, eightBeatClip, 2).map((move) => move.value)).toEqual([0]);
        });

        it('carries the last row of a controller across the channels', () => {
            const lane = [
                controller('ch0-early', 0.25, 0),
                controller('ch1', 0.5, 0, 64, 1),
                controller('ch0-late', 1, 127),
            ];

            expect(placed(restoreAt(lane, eightBeatClip, 2).moves)).toEqual([{ controller: 64, beat: 2, value: 127 }]);
        });
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
        /**
         * Sustain on channel 0, a CC11 on channel 2, and more sustain rows on channel 1: the sustain
         * is one controller whichever channel a row names, so the two sustain lists are one value.
         */
        const laneSets = [
            {
                sustainRows: [
                    { content: 0, value: 127 },
                    { content: 63, value: 0 },
                ],
                otherChannelSustainRows: [{ content: 30, value: 5 }],
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
                otherChannelSustainRows: [
                    { content: 60, value: 7 },
                    { content: 100, value: 3 },
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
                        for (const { sustainRows, otherChannelSustainRows, dynamicsRows } of laneSets) {
                            const lanes = [
                                ...sustainRows.map((row, index) =>
                                    controller(`sustain-${index}`, toBeat(row.content), row.value)
                                ),
                                ...otherChannelSustainRows.map((row, index) =>
                                    controller(`sustain-ch1-${index}`, toBeat(row.content), row.value, 64, 1)
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
                                ...[...sustainRows, ...otherChannelSustainRows, ...dynamicsRows].map(
                                    (row) => row.content
                                ),
                                offset + 5,
                                offset + 11,
                            ].filter((content) => content >= offset && content < offset + length);
                            for (let pass = 0; pass < 3; pass++) {
                                for (const content of contents) {
                                    const destination = toBeat(startUnits + pass * length + (content - offset));
                                    const expected = valuesHeldByContinuousPlayback(
                                        [{ clip, controlChanges: lanes }],
                                        destination
                                    );

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

    describe('against continuous playback across several clips of a track', () => {
        /** Everything is a whole number of 1/84 beats; every start, offset and row is a multiple of 7 units (1/12 beat). */
        const UNITS_PER_BEAT = 84;
        const toBeat = (units: number) => units / UNITS_PER_BEAT;
        const firstClipStarts = [28, 42, 56, 70];
        // The second clip's start against the first's: a start behind it, and starts 28 units off, where the
        // rows of the two clips are placed on the same beat by different float arithmetic; then overlapping,
        // abutting it and leaving a gap after it, for the lengths below.
        const secondClipDeltas = [-28, 28, 56, 98, 112, 126];
        const lengths = [112, 168];
        const offsets = [0, 14];
        const loops = [null, 56];
        // Each clip also stores a row on its closing line (offset + loop length, or offset + length),
        // which plays on the clip end only, and the second clip a sustain row on its head, so the
        // abutting pair (a delta of one length) puts a closing-line move and a head move on one frame.
        const firstClipRows = (closingUnits: number) => [
            controller('a-down', toBeat(21), 127),
            controller('a-up', toBeat(77), 0),
            controller('a-dynamics', toBeat(35), 33, 11, 2),
            controller('a-closing', toBeat(closingUnits), 3),
            controller('a-closing-dynamics', toBeat(closingUnits), 66, 11, 2),
        ];
        const secondClipRows = (headUnits: number, closingUnits: number) => [
            controller('b-head', toBeat(headUnits), 44, 64, 1),
            controller('b-sustain', toBeat(49), 5, 64, 1),
            controller('b-up', toBeat(91), 9, 64, 1),
            controller('b-dynamics', toBeat(63), 77, 11, 3),
            controller('b-closing', toBeat(closingUnits), 11, 64, 1),
        ];

        it('sends exactly the value continuous playback holds at every destination: inside, between and after the clips', () => {
            let checked = 0;
            for (const firstStart of firstClipStarts) {
                for (const delta of secondClipDeltas) {
                    const secondStart = firstStart + delta;
                    for (const length of lengths) {
                        for (const offset of offsets) {
                            for (const loop of loops) {
                                const shape = (start: number) => ({
                                    startBeat: toBeat(start),
                                    endBeat: toBeat(start + length),
                                    midiOffsetBeats: toBeat(offset),
                                    loopEnabled: loop !== null,
                                    loopLength: loop === null ? undefined : toBeat(loop),
                                });
                                const closingUnits = offset + (loop ?? length);
                                const clips = [
                                    { clip: shape(firstStart), controlChanges: firstClipRows(closingUnits) },
                                    {
                                        clip: shape(secondStart),
                                        controlChanges: secondClipRows(offset, closingUnits),
                                    },
                                ];
                                for (
                                    let destination = Math.min(firstStart, secondStart);
                                    destination <= Math.max(firstStart, secondStart) + length + 28;
                                    destination += 7
                                ) {
                                    const expected = valuesHeldByContinuousPlayback(clips, toBeat(destination));

                                    const sent = new Map<string, number>();
                                    for (const move of sentTrackAtDestination(clips, toBeat(destination))) {
                                        sent.set(laneOf(move), move.value);
                                    }

                                    expect(
                                        sent,
                                        `clips ${firstStart} and ${secondStart}, length ${length}, offset ${offset}, loop ${loop}, destination ${destination}`
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
