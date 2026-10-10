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

    it('marks every move that is not on the closing line as an ordinary move', () => {
        const events = projectClipControllerEvents({
            controlChanges: [controller('down', 0, 127), controller('mid', 2, 0)],
            clip: { startBeat: 4, endBeat: 8 },
            fromBeat: 4,
            toBeat: 8,
        });

        expect(events.map((event) => event.closesClip)).toEqual([false, false]);
    });

    describe('with a move stored on the closing line of a clip that does not loop', () => {
        // The reported case: a sustained phrase from beat 1 to beat 5 whose pedal is lifted on the final bar line.
        const lane = [controller('down', 0, 127), controller('lift', 4, 0)];
        const clip = { startBeat: 1, endBeat: 5 };

        it('lifts the pedal on the clip end', () => {
            const events = projectClipControllerEvents({ controlChanges: lane, clip, fromBeat: 0, toBeat: 8 });

            expect(events.map(({ beat, value, closesClip }) => ({ beat, value, closesClip }))).toEqual([
                { beat: 1, value: 127, closesClip: false },
                { beat: 5, value: 0, closesClip: true },
            ]);
        });

        it('owns the lift in the window that closes on the clip end, not in the one that opens there', () => {
            const closing = projectClipControllerEvents({ controlChanges: lane, clip, fromBeat: 3, toBeat: 5 });
            const opening = projectClipControllerEvents({ controlChanges: lane, clip, fromBeat: 5, toBeat: 7 });
            const spanning = projectClipControllerEvents({ controlChanges: lane, clip, fromBeat: 4.5, toBeat: 5.5 });

            expect(closing.map((event) => event.id)).toEqual(['lift']);
            expect(opening).toEqual([]);
            expect(spanning.map((event) => event.id)).toEqual(['lift']);
        });

        it('places the lift on exactly the clip end however its beat rounds against a non-dyadic start', () => {
            const thirdsClip = { startBeat: 2 / 3, endBeat: 2 / 3 + 4 / 3, midiOffsetBeats: 1 / 3 };
            const events = projectClipControllerEvents({
                controlChanges: [controller('down', 1 / 3, 127), controller('lift', 1 / 3 + 4 / 3, 0)],
                clip: thirdsClip,
                fromBeat: 0,
                toBeat: 4,
            });

            expect(events.at(-1)).toMatchObject({ id: 'lift', beat: thirdsClip.endBeat, closesClip: true });
        });
    });

    describe('with a row on the closing line that is not a switch release', () => {
        it('plays no pedal press where a comp cut ends a take on it', () => {
            // Take 1 re-presses the pedal on beat 4 for its next phrase, and the comp cuts to a
            // take 2 with no pedal rows there: the press would hold the pedal down until stop.
            const take1Slice = { startBeat: 0, endBeat: 4 };
            const events = projectClipControllerEvents({
                controlChanges: [controller('down', 0, 127), controller('lift', 3, 0), controller('re-press', 4, 127)],
                clip: take1Slice,
                fromBeat: 0,
                toBeat: 8,
            });

            expect(events.map(({ id, beat, value }) => [id, beat, value])).toEqual([
                ['down', 0, 127],
                ['lift', 3, 0],
            ]);
        });

        it('plays no pedal press where a trim moves the clip end onto it', () => {
            const lane = [
                controller('down', 0, 127),
                controller('lift', 2, 0),
                controller('down-again', 4, 127),
                controller('lift-again', 6, 0),
            ];
            const events = projectClipControllerEvents({
                controlChanges: lane,
                clip: { startBeat: 8, endBeat: 12 },
                fromBeat: 0,
                toBeat: 16,
            });

            expect(events.map(({ id, beat }) => [id, beat])).toEqual([
                ['down', 8],
                ['lift', 10],
            ]);
        });

        it.each([
            ['a mod-wheel row', controller('mod', 4, 0, 1)],
            ['an expression row', controller('expression', 4, 0, 11)],
            ['a sostenuto press', controller('sostenuto', 4, 64, 66)],
        ])('plays %s on the closing line nowhere, while a lift beside it still plays', (_kind, row) => {
            const events = projectClipControllerEvents({
                controlChanges: [controller('down', 0, 127), row, controller('lift', 4, 0)],
                clip: { startBeat: 0, endBeat: 4 },
                fromBeat: 0,
                toBeat: 8,
            });

            expect(events.map(({ id, beat, closesClip }) => [id, beat, closesClip])).toEqual([
                ['down', 0, false],
                ['lift', 4, true],
            ]);
        });

        it('plays a sostenuto or una corda release on the closing line, below the latch threshold', () => {
            const events = projectClipControllerEvents({
                controlChanges: [controller('sostenuto-off', 4, 63, 66), controller('una-corda-off', 4, 0, 67)],
                clip: { startBeat: 0, endBeat: 4 },
                fromBeat: 0,
                toBeat: 8,
            });

            expect(events.map(({ id, closesClip }) => [id, closesClip])).toEqual([
                ['sostenuto-off', true],
                ['una-corda-off', true],
            ]);
        });
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

    it('plays a move on the clip closing line at the clip end, drops moves past it, and returns nothing for an empty lane', () => {
        expect(
            projectClipControllerEvents({
                controlChanges: [controller('past-end', 4.5, 127), controller('closing', 4, 0)],
                clip: { startBeat: 0, endBeat: 4 },
                fromBeat: 0,
                toBeat: 8,
            })
        ).toEqual([{ ...controller('closing', 4, 0), closesClip: true }]);
        expect(
            projectClipControllerEvents({
                controlChanges: [],
                clip: { startBeat: 0, endBeat: 4 },
                fromBeat: 0,
                toBeat: 4,
            })
        ).toEqual([]);
    });

    describe('with a move stored on the closing line of the loop', () => {
        const PASSES = 4;

        function pedalEvents(loop: { start: number; length: number; offset?: number }, closingBeat?: number) {
            const midiOffsetBeats = loop.offset ?? 0;
            const endBeat = loop.start + PASSES * loop.length;
            const events = projectClipControllerEvents({
                controlChanges: [
                    controller('down', midiOffsetBeats, 127),
                    controller('lift', closingBeat ?? midiOffsetBeats + loop.length, 0),
                ],
                clip: { startBeat: loop.start, endBeat, midiOffsetBeats, loopEnabled: true, loopLength: loop.length },
                fromBeat: loop.start - 1,
                toBeat: endBeat + 1,
            });
            return { events, midiOffsetBeats };
        }

        it.each([
            { start: 1 / 3, length: 2 },
            { start: 1 / 6, length: 1 },
            { start: 2 / 3, length: 4 },
            { start: 0, length: 4 / 3 },
        ])(
            'holds the pedal down at every pass head of a loop of $length from $start and lifts it on the clip end',
            (loop) => {
                const { events } = pedalEvents(loop);

                expect(events.map((event) => event.value)).toEqual([127, 127, 127, 127, 0]);
                for (const [pass, event] of events.slice(0, PASSES).entries()) {
                    expect(event.beat).toBeCloseTo(loop.start + pass * loop.length, 9);
                }
                expect(events.at(-1)!.beat).toBe(loop.start + PASSES * loop.length);
            }
        );

        it('plays the closing-line move on the clip end only, never on an inner seam, across non-dyadic starts, lengths and offsets', () => {
            const starts = [0, 1 / 3, 1 / 6, 2 / 3, 0.1, 7 / 3, 1000 / 3, 12345.1];
            const lengths = [1, 2, 4, 4 / 3, 0.7, 1 / 3, 5 / 6];
            const offsets = [0, 1 / 3, 0.1];
            let swept = 0;
            for (const start of starts) {
                for (const length of lengths) {
                    for (const offset of offsets) {
                        const { events } = pedalEvents({ start, length, offset });
                        const label = `start ${start}, loop ${length}, offset ${offset}`;
                        expect(
                            events.map(({ value, closesClip }) => [value, closesClip]),
                            label
                        ).toEqual([
                            [127, false],
                            [127, false],
                            [127, false],
                            [127, false],
                            [0, true],
                        ]);
                        expect(events.at(-1)!.beat, label).toBe(start + PASSES * length);
                        swept++;
                    }
                }
            }
            expect(swept).toBe(starts.length * lengths.length * offsets.length);
        });

        it('plays the closing-line move of a clip that does not loop on its end', () => {
            const events = projectClipControllerEvents({
                controlChanges: [controller('down', 0, 127), controller('lift', 4 / 3, 0)],
                clip: { startBeat: 2 / 3, endBeat: 2 / 3 + 4 / 3, loopEnabled: false },
                fromBeat: 0,
                toBeat: 4,
            });

            expect(events.map((event) => event.value)).toEqual([127, 0]);
            expect(events.at(-1)!.beat).toBe(2 / 3 + 4 / 3);
        });

        it('plays a move on the closing line of a trimmed final pass on the clip end', () => {
            // Two and a half passes of a two-beat loop: the clip ends one beat into the third pass,
            // so the content beat one past the offset is that pass's closing line, and an inner pass
            // plays the same row mid-pass.
            const events = projectClipControllerEvents({
                controlChanges: [controller('down', 0, 127), controller('mid', 1, 0)],
                clip: { startBeat: 0, endBeat: 5, loopEnabled: true, loopLength: 2 },
                fromBeat: 0,
                toBeat: 8,
            });

            expect(events.map(({ beat, value, closesClip }) => [beat, value, closesClip])).toEqual([
                [0, 127, false],
                [1, 0, false],
                [2, 127, false],
                [3, 0, false],
                [4, 127, false],
                [5, 0, true],
            ]);
        });

        it('still plays a move that sits just inside the loop end on every pass', () => {
            const loop = { start: 1 / 3, length: 2 };
            const { events } = pedalEvents(loop, loop.length - 1e-6);

            expect(events.map((event) => event.value)).toEqual([127, 0, 127, 0, 127, 0, 127, 0]);
            expect(events[1]!.beat).toBeCloseTo(loop.start + loop.length - 1e-6, 9);
        });
    });

    describe('across back-to-back scheduler windows on non-dyadic clips', () => {
        const STEPS = [0.25, 1 / 3, 1];
        const STARTS = [2 / 3, 1 / 3, 1 / 7, 7 / 3];
        const OFFSETS = [0, 1 / 7, 1 / 3, 0.25];
        const LOOPS = [2, 1, 4 / 3, 1 / 3];
        const PASS_BEATS = 8;

        type Clip = Parameters<typeof projectClipControllerEvents>[0]['clip'];

        function clipOf(start: number, offset: number, loop: number, length = PASS_BEATS): Clip {
            return {
                startBeat: start,
                endBeat: start + length,
                midiOffsetBeats: offset,
                loopEnabled: true,
                loopLength: loop,
            };
        }

        /** What a scheduler stepping `[a, a + step)` from `origin` hands the controller projection, window by window. */
        function steppedEvents(controlChanges: readonly MidiCC[], clip: Clip, step: number, origin: number) {
            const events: ReturnType<typeof projectClipControllerEvents> = [];
            let from = origin;
            while (from < clip.endBeat + 2 * step) {
                const to = from + step;
                events.push(...projectClipControllerEvents({ controlChanges, clip, fromBeat: from, toBeat: to }));
                from = to;
            }
            return events;
        }

        function wholeClip(controlChanges: readonly MidiCC[], clip: Clip) {
            return projectClipControllerEvents({
                controlChanges,
                clip,
                fromBeat: clip.startBeat - 1,
                toBeat: clip.endBeat + 1,
            });
        }

        it('loses no head row at the window boundary on the clip start', () => {
            const controlChanges = [controller('down', 1 / 7, 127)];
            const clip = clipOf(2 / 3, 1 / 7, 2);

            const before = projectClipControllerEvents({ controlChanges, clip, fromBeat: 0, toBeat: 2 / 3 });
            const after = projectClipControllerEvents({ controlChanges, clip, fromBeat: 2 / 3, toBeat: 1 });

            expect(before.length + after.length).toBe(1);
        });

        it('emits every pass head row exactly once in any chain of windows', () => {
            let swept = 0;
            for (const start of STARTS) {
                for (const offset of OFFSETS) {
                    for (const loop of LOOPS) {
                        const controlChanges = [controller('down', offset, 127)];
                        const clip = clipOf(start, offset, loop);
                        const expected = wholeClip(controlChanges, clip).map((event) => event.beat);
                        expect(expected).toHaveLength(Math.ceil(PASS_BEATS / loop));
                        for (const step of STEPS) {
                            for (const origin of [0, start - step, start - 2 * step]) {
                                const emitted = steppedEvents(controlChanges, clip, step, origin).map(
                                    (event) => event.beat
                                );
                                expect(
                                    emitted.sort((left, right) => left - right),
                                    `start ${start}, offset ${offset}, loop ${loop}, step ${step}, origin ${origin}`
                                ).toEqual(expected);
                                swept++;
                            }
                        }
                    }
                }
            }
            expect(swept).toBe(STARTS.length * OFFSETS.length * LOOPS.length * STEPS.length * 3);
        });

        it('emits the closing-line move exactly once, on the clip end, in any chain of windows', () => {
            let swept = 0;
            for (const start of STARTS) {
                for (const offset of OFFSETS) {
                    for (const loop of LOOPS) {
                        const controlChanges = [controller('down', offset, 127), controller('lift', offset + loop, 0)];
                        const clip = clipOf(start, offset, loop);
                        for (const step of STEPS) {
                            for (const origin of [0, start - step, start - 2 * step]) {
                                const closing = steppedEvents(controlChanges, clip, step, origin).filter(
                                    (event) => event.closesClip
                                );
                                expect(
                                    closing.map(({ id, beat }) => [id, beat]),
                                    `start ${start}, offset ${offset}, loop ${loop}, step ${step}, origin ${origin}`
                                ).toEqual([['lift', clip.endBeat]]);
                                swept++;
                            }
                        }
                    }
                }
            }
            expect(swept).toBe(STARTS.length * OFFSETS.length * LOOPS.length * STEPS.length * 3);
        });

        it('lets go of a held pedal on a trimmed loop and leaves nothing on the clip end', () => {
            const controlChanges = [controller('press', 0, 127), controller('lift', 0.6, 0)];
            const clip: Clip = {
                startBeat: 2 / 3,
                endBeat: 2,
                midiOffsetBeats: 0.5,
                loopEnabled: true,
                loopLength: 1 / 3,
            };

            expect(projectClipControllerEvents({ controlChanges, clip, fromBeat: 2, toBeat: 3 })).toEqual([]);
        });

        it('places no event at or after the clip end on any window of a trimmed loop', () => {
            let swept = 0;
            for (const start of STARTS) {
                for (const offset of OFFSETS) {
                    for (const loop of LOOPS) {
                        for (const length of [2, 3.5, 5]) {
                            const controlChanges = [controller('press', 0, 127), controller('lift', offset + 1e-4, 0)];
                            const clip = clipOf(start, offset, loop, length);
                            for (const step of STEPS) {
                                const events = steppedEvents(controlChanges, clip, step, start - step);
                                const late = events.filter((event) => event.beat >= clip.endBeat - 1e-9);
                                expect(
                                    late,
                                    `start ${start}, offset ${offset}, loop ${loop}, length ${length}, step ${step}`
                                ).toEqual([]);
                                expect(events.at(-1)?.value, 'the sustain ends released').toBe(0);
                                swept++;
                            }
                        }
                    }
                }
            }
            expect(swept).toBe(STARTS.length * OFFSETS.length * LOOPS.length * 3 * STEPS.length);
        });

        it('still plays the head row of a genuine short final pass', () => {
            const controlChanges = [controller('down', 0, 127)];
            const clip: Clip = {
                startBeat: 0,
                endBeat: 4 + 1e-6,
                midiOffsetBeats: 0,
                loopEnabled: true,
                loopLength: 2,
            };

            const events = projectClipControllerEvents({ controlChanges, clip, fromBeat: 0, toBeat: 8 });

            expect(events.map((event) => event.beat)).toEqual([0, 2, 4]);
        });
    });
});
