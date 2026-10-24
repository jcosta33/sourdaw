import { describe, expect, it } from 'vitest';

import { type MidiCC, type MidiPitchBend } from '../../../models/MidiNote';
import { projectChannelBend } from '../projectChannelBend';

/** 120 BPM at 48 kHz: one beat is half a second, 24000 frames. */
function frameAtBeat(beat: number): number {
    return Math.round(beat * 24_000);
}

function bend(id: string, beat: number, value: number, channel = 0): MidiPitchBend {
    return { id, beat, value, channel };
}

function controller(id: string, beat: number, cc: number, value: number, channel = 0): MidiCC {
    return { id, beat, controller: cc, value, channel };
}

/** Select RPN 0 and enter a range, then the Null RPN a controller sends after a data entry. */
function declareRange(beat: number, semitones: number, cents = 0, channel = 0): MidiCC[] {
    return [
        controller(`rpn-msb-${beat}-${channel}`, beat, 101, 0, channel),
        controller(`rpn-lsb-${beat}-${channel}`, beat, 100, 0, channel),
        controller(`data-msb-${beat}-${channel}`, beat, 6, semitones, channel),
        controller(`data-lsb-${beat}-${channel}`, beat, 38, cents, channel),
        controller(`null-msb-${beat}-${channel}`, beat, 101, 127, channel),
        controller(`null-lsb-${beat}-${channel}`, beat, 100, 127, channel),
    ];
}

/** Select RPN 0 and enter a range, leaving the selection open as a controller that never closes it does. */
function declareRangeWithoutNull(beat: number, semitones: number, channel = 0): MidiCC[] {
    return declareRange(beat, semitones, 0, channel).slice(0, 4);
}

function summarize(points: ReturnType<typeof projectChannelBend>) {
    return points.map(({ beat, value, rangeSemitones }) => ({ beat, value, rangeSemitones }));
}

describe('projectChannelBend', () => {
    it('lists every move of the track in posting order, on the caller’s clock', () => {
        const points = projectChannelBend({
            clips: [
                {
                    clip: { startBeat: 2, endBeat: 10, midiOffsetBeats: 1 },
                    controlChanges: [],
                    pitchBends: [bend('out', 2, 8_191), bend('return', 3, 0)],
                },
            ],
            frameAtBeat,
        });

        expect(points).toEqual([
            {
                beat: 3,
                frame: 72_000,
                recordedBeat: 3,
                value: 8_191,
                rangeSemitones: 2,
                channel: 0,
                channelScoped: false,
            },
            { beat: 4, frame: 96_000, recordedBeat: 4, value: 0, rangeSemitones: 2, channel: 0, channelScoped: false },
        ]);
    });

    it('keeps where a move a trimmed clip head carries onto the head was recorded', () => {
        // The clip at 2 plays content from beat 2, so content beat c lands on c: the move at content 0.5 is
        // carried onto the head at 2 though it was recorded at 0.5, before the clip starts.
        const points = projectChannelBend({
            clips: [
                {
                    clip: { startBeat: 2, endBeat: 10, midiOffsetBeats: 2 },
                    controlChanges: [],
                    pitchBends: [bend('stale', 0.5, 4_096), bend('later', 3, 0)],
                },
            ],
            frameAtBeat,
        });

        expect(points.map(({ beat, frame, recordedBeat }) => ({ beat, frame, recordedBeat }))).toEqual([
            { beat: 2, frame: 48_000, recordedBeat: 0.5 },
            { beat: 3, frame: 72_000, recordedBeat: 3 },
        ]);
    });

    it('orders by sample frame, then clip sequence, never by float beat', () => {
        // Rows 0.00001 of a beat apart share a frame; the instrument ends on the later clip's, whatever the beat order.
        const points = projectChannelBend({
            clips: [
                { clip: { startBeat: 0, endBeat: 4 }, controlChanges: [], pitchBends: [bend('a', 1.00001, 100)] },
                { clip: { startBeat: 0, endBeat: 4 }, controlChanges: [], pitchBends: [bend('b', 1, 200)] },
            ],
            frameAtBeat,
        });

        expect(points.map((point) => point.value)).toEqual([100, 200]);
        expect(points.map((point) => point.frame)).toEqual([24_000, 24_000]);
    });

    it('orders by sample frame before clip sequence, so an earlier beat of a later clip comes first', () => {
        const points = projectChannelBend({
            clips: [
                { clip: { startBeat: 0, endBeat: 4 }, controlChanges: [], pitchBends: [bend('late', 2, 100)] },
                { clip: { startBeat: 0, endBeat: 4 }, controlChanges: [], pitchBends: [bend('early', 1, 200)] },
            ],
            frameAtBeat,
        });

        expect(points.map((point) => point.value)).toEqual([200, 100]);
    });

    it('keeps the clip sequence ahead of the row order within one frame', () => {
        // Clip B's only row shares a frame with the second row of clip A: the later clip is last.
        const points = projectChannelBend({
            clips: [
                {
                    clip: { startBeat: 0, endBeat: 4 },
                    controlChanges: [],
                    pitchBends: [bend('a0', 0.5, 50), bend('a1', 1.00001, 100)],
                },
                { clip: { startBeat: 0, endBeat: 4 }, controlChanges: [], pitchBends: [bend('b0', 1, 200)] },
            ],
            frameAtBeat,
        });

        expect(points.map((point) => point.value)).toEqual([50, 100, 200]);
    });

    it('lists only the moves of the window it is given, with the depth the clip declared before it', () => {
        const clips = [
            {
                clip: { startBeat: 0, endBeat: 8 },
                controlChanges: declareRange(0, 12),
                pitchBends: [bend('a', 1, 100), bend('b', 3, 200), bend('c', 5, 300)],
            },
        ];

        const window = projectChannelBend({ clips, frameAtBeat, fromBeat: 2, toBeat: 5 });
        const upToTheWindowEnd = projectChannelBend({
            clips,
            frameAtBeat,
            fromBeat: Number.NEGATIVE_INFINITY,
            toBeat: 5,
        });

        expect(summarize(window)).toEqual([{ beat: 3, value: 200, rangeSemitones: 12 }]);
        // From the start of the timeline the window lists what an earlier, muted span kept from the instrument.
        expect(upToTheWindowEnd.map((point) => point.value)).toEqual([100, 200]);
    });

    it('lists the rows of a lane stored out of beat order by beat', () => {
        const points = projectChannelBend({
            clips: [
                {
                    clip: { startBeat: 0, endBeat: 4 },
                    controlChanges: [],
                    pitchBends: [bend('late', 3, 100), bend('early', 1, 200)],
                },
            ],
            frameAtBeat,
        });

        expect(points.map((point) => point.value)).toEqual([200, 100]);
    });

    it('leaves the last move of a clip in force past the clip end and into the clip after it', () => {
        const points = projectChannelBend({
            clips: [
                { clip: { startBeat: 0, endBeat: 2 }, controlChanges: [], pitchBends: [bend('out', 1, 8_191)] },
                { clip: { startBeat: 4, endBeat: 8 }, controlChanges: [], pitchBends: [] },
            ],
            frameAtBeat,
        });

        // No move at the clip end or at the next clip's start: nothing resets the bend.
        expect(summarize(points)).toEqual([{ beat: 1, value: 8_191, rangeSemitones: 2 }]);
    });

    it('repeats a looped clip, each pass opening on the bend in force at its head', () => {
        const points = projectChannelBend({
            clips: [
                {
                    // Visible content is [1, 3): the bend out at content 0 is carried to each pass head.
                    clip: { startBeat: 0, endBeat: 4, midiOffsetBeats: 1, loopEnabled: true, loopLength: 2 },
                    controlChanges: [],
                    pitchBends: [bend('out', 0, 8_191), bend('return', 1.5, 0)],
                },
            ],
            frameAtBeat,
        });

        expect(summarize(points)).toEqual([
            { beat: 0, value: 8_191, rangeSemitones: 2 },
            { beat: 0.5, value: 0, rangeSemitones: 2 },
            { beat: 2, value: 8_191, rangeSemitones: 2 },
            { beat: 2.5, value: 0, rangeSemitones: 2 },
        ]);
    });

    describe('the depth a move is read against', () => {
        const clip = { startBeat: 0, endBeat: 8 };

        it('is the MIDI 1.0 default of two semitones when the clip declared none', () => {
            const [point] = projectChannelBend({
                clips: [{ clip, controlChanges: [controller('mod', 0, 1, 64)], pitchBends: [bend('a', 1, 4_096)] }],
                frameAtBeat,
            });

            expect(point?.rangeSemitones).toBe(2);
        });

        it('is the RPN 0 the clip declared before the move, and a Null RPN after the data entry leaves it in force', () => {
            const points = projectChannelBend({
                clips: [
                    {
                        clip,
                        controlChanges: declareRange(0, 12),
                        pitchBends: [bend('a', 1, 4_096)],
                    },
                ],
                frameAtBeat,
            });

            expect(points.map((point) => point.rangeSemitones)).toEqual([12]);
        });

        it('adds the cents of the data entry LSB', () => {
            const [point] = projectChannelBend({
                clips: [{ clip, controlChanges: declareRange(0, 7, 50), pitchBends: [bend('a', 1, 4_096)] }],
                frameAtBeat,
            });

            expect(point?.rangeSemitones).toBe(7.5);
        });

        it('reads the declarations in beat order whatever order the rows are stored in', () => {
            // Select at 0, enter at 0.5, Null RPN at 1: stored back to front, the Null RPN would come first
            // and the data entry would find no parameter selected.
            const [point] = projectChannelBend({
                clips: [
                    {
                        clip,
                        controlChanges: [
                            controller('null-msb', 1, 101, 127),
                            controller('null-lsb', 1, 100, 127),
                            controller('data', 0.5, 6, 12),
                            controller('rpn-lsb', 0, 100, 0),
                            controller('rpn-msb', 0, 101, 0),
                        ],
                        pitchBends: [bend('a', 2, 4_096)],
                    },
                ],
                frameAtBeat,
            });

            expect(point?.rangeSemitones).toBe(12);
        });

        it('takes a declaration on the beat of the move as made before it, whatever float noise the placement left', () => {
            // At clip start 0.3 and content offset 0.2 the move placed from content beat 1.3 reads back as
            // 1.2999999999999998, just before the declaration on the same beat.
            const [point] = projectChannelBend({
                clips: [
                    {
                        clip: { startBeat: 0.3, endBeat: 8, midiOffsetBeats: 0.2 },
                        controlChanges: declareRange(1.3, 12),
                        pitchBends: [bend('a', 1.3, 4_096)],
                    },
                ],
                frameAtBeat,
            });

            expect(point?.rangeSemitones).toBe(12);
        });

        it('applies a declaration to the moves after it and not the ones before', () => {
            const points = projectChannelBend({
                clips: [
                    {
                        clip,
                        controlChanges: declareRange(2, 24),
                        pitchBends: [bend('before', 1, 100), bend('after', 3, 100)],
                    },
                ],
                frameAtBeat,
            });

            expect(points.map((point) => point.rangeSemitones)).toEqual([2, 24]);
        });

        it('is read at the content beat of the move, whatever beat the clip sits at on the timeline', () => {
            // The clip sits at 4, so content beat c plays at c + 4. ±2 is declared at content 0 and ±24 at
            // content 3 (timeline 7): the move at content 2 (timeline 6) is still ±2, though the second
            // declaration is already behind its timeline beat; the move at content 4 (timeline 8) is ±24.
            const points = projectChannelBend({
                clips: [
                    {
                        clip: { startBeat: 4, endBeat: 12 },
                        controlChanges: [...declareRange(0, 2), ...declareRange(3, 24)],
                        pitchBends: [bend('before', 2, 100), bend('after', 4, 100)],
                    },
                ],
                frameAtBeat,
            });

            expect(points.map((point) => [point.beat, point.rangeSemitones])).toEqual([
                [6, 2],
                [8, 24],
            ]);
        });

        it('belongs to the channel that declared it', () => {
            const points = projectChannelBend({
                clips: [
                    {
                        clip,
                        controlChanges: declareRange(0, 12, 0, 1),
                        pitchBends: [bend('channel-0', 1, 100, 0), bend('channel-1', 1, 100, 1)],
                    },
                ],
                frameAtBeat,
            });

            expect(points.map((point) => point.rangeSemitones)).toEqual([2, 12]);
        });

        it('ignores a data entry that arrives while no RPN is selected, which is just a controller', () => {
            const [point] = projectChannelBend({
                clips: [
                    {
                        clip,
                        controlChanges: [controller('mod-wheel', 0, 6, 24)],
                        pitchBends: [bend('a', 1, 4_096)],
                    },
                ],
                frameAtBeat,
            });

            expect(point?.rangeSemitones).toBe(2);
        });

        it('ignores a data entry written to the NRPN or RPN a bend range is not', () => {
            const [point] = projectChannelBend({
                clips: [
                    {
                        clip,
                        controlChanges: [
                            controller('nrpn-msb', 0, 99, 0),
                            controller('nrpn-lsb', 0, 98, 0),
                            controller('data', 0, 6, 24),
                        ],
                        pitchBends: [bend('a', 1, 4_096)],
                    },
                ],
                frameAtBeat,
            });

            expect(point?.rangeSemitones).toBe(2);
        });

        describe('of a move carried onto a pass head', () => {
            // ±12 is declared at 0.1, the bend is recorded at 1.2 under it, and ±2 is declared at 1.3.
            const controlChanges = [...declareRangeWithoutNull(0.1, 12), ...declareRangeWithoutNull(1.3, 2)];
            const pitchBends = [bend('recorded', 1.2, 8_191)];

            it('is the one in force where its row was recorded, not at the trimmed clip head it sits on', () => {
                const [point] = projectChannelBend({
                    clips: [
                        {
                            clip: { startBeat: 1.35, endBeat: 4, midiOffsetBeats: 1.35 },
                            controlChanges,
                            pitchBends,
                        },
                    ],
                    frameAtBeat,
                });

                expect(point).toMatchObject({ beat: 1.35, recordedBeat: 1.2, value: 8_191, rangeSemitones: 12 });
            });

            it('is the one in force where its row was recorded, not at the loop pass head it sits on', () => {
                // Visible content is [1.35, 3.35): the bend recorded at 1.2 is carried onto both pass heads,
                // though the second declaration at 1.3 lies between it and each of them.
                const points = projectChannelBend({
                    clips: [
                        {
                            clip: {
                                startBeat: 0,
                                endBeat: 4,
                                midiOffsetBeats: 1.35,
                                loopEnabled: true,
                                loopLength: 2,
                            },
                            controlChanges,
                            pitchBends,
                        },
                    ],
                    frameAtBeat,
                });

                expect(points.map((point) => [point.beat, point.rangeSemitones])).toEqual([
                    [0, 12],
                    [2, 12],
                ]);
            });

            it('still reads a move the pass reaches at the depth in force at its own beat', () => {
                const points = projectChannelBend({
                    clips: [
                        {
                            clip: { startBeat: 1.35, endBeat: 4, midiOffsetBeats: 1.35 },
                            controlChanges,
                            pitchBends: [...pitchBends, bend('after', 2, 100)],
                        },
                    ],
                    frameAtBeat,
                });

                expect(points.map((point) => [point.beat, point.rangeSemitones])).toEqual([
                    [1.35, 12],
                    [2, 2],
                ]);
            });

            it('is unchanged for the untrimmed clip, whose bend is recorded where it plays', () => {
                const [point] = projectChannelBend({
                    clips: [{ clip: { startBeat: 0, endBeat: 4 }, controlChanges, pitchBends }],
                    frameAtBeat,
                });

                expect(point).toMatchObject({ beat: 1.2, recordedBeat: 1.2, rangeSemitones: 12 });
            });
        });

        it('is the one in force at the head of a loop pass the move is carried to', () => {
            const points = projectChannelBend({
                clips: [
                    {
                        clip: { startBeat: 0, endBeat: 4, midiOffsetBeats: 1, loopEnabled: true, loopLength: 2 },
                        // Declared before the visible span, so only the clip's own order says it is in force.
                        controlChanges: declareRange(0, 12),
                        pitchBends: [bend('out', 0, 4_096)],
                    },
                ],
                frameAtBeat,
            });

            expect(points.map((point) => [point.beat, point.rangeSemitones])).toEqual([
                [0, 12],
                [2, 12],
            ]);
        });
    });

    describe('per MIDI channel', () => {
        const clip = { startBeat: 0, endBeat: 8 };

        it('keeps the channel each move was recorded on, with the depth that channel declared', () => {
            const points = projectChannelBend({
                clips: [
                    {
                        clip,
                        controlChanges: [...declareRange(0, 12, 0, 1), ...declareRange(0, 24, 0, 2)],
                        pitchBends: [bend('left', 1, 4_096, 1), bend('right', 1, -4_096, 2)],
                    },
                ],
                frameAtBeat,
            });

            expect(points.map(({ channel, value, rangeSemitones }) => ({ channel, value, rangeSemitones }))).toEqual([
                { channel: 1, value: 4_096, rangeSemitones: 12 },
                { channel: 2, value: -4_096, rangeSemitones: 24 },
            ]);
        });

        it('scopes a move to its channel only when the recorder marked the row', () => {
            const points = projectChannelBend({
                clips: [
                    {
                        clip,
                        controlChanges: [],
                        pitchBends: [
                            { ...bend('recorded', 1, 4_096, 1), channelScoped: true },
                            bend('drawn', 2, 100, 0),
                            bend('imported-channel', 3, 200, 5),
                        ],
                    },
                ],
                frameAtBeat,
            });

            expect(points.map(({ value, channel, channelScoped }) => ({ value, channel, channelScoped }))).toEqual([
                { value: 4_096, channel: 1, channelScoped: true },
                { value: 100, channel: 0, channelScoped: false },
                { value: 200, channel: 5, channelScoped: false },
            ]);
        });

        it('keeps a row’s mark through a loop pass and a content offset', () => {
            const points = projectChannelBend({
                clips: [
                    {
                        clip: { startBeat: 0, endBeat: 4, midiOffsetBeats: 1, loopEnabled: true, loopLength: 2 },
                        controlChanges: [],
                        pitchBends: [{ ...bend('recorded', 1.5, 4_096, 1), channelScoped: true }],
                    },
                ],
                frameAtBeat,
            });

            expect(points.length).toBeGreaterThan(1);
            expect(points.every((point) => point.channelScoped)).toBe(true);
        });
    });
});
