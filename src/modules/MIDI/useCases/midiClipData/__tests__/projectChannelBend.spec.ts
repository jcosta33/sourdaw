import { describe, expect, it } from 'vitest';

import { midiFragmentWindowEntry, resolveLoopedOffsetBeats } from '#/utils/clipLoopOrigin';

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

    it('keeps the channel of every move and the scope of a recorded wheel', () => {
        const points = projectChannelBend({
            clips: [
                {
                    clip: { startBeat: 0, endBeat: 8, midiOffsetBeats: 0 },
                    controlChanges: [],
                    pitchBends: [{ ...bend('wheel', 1, 8_191, 2), channelScoped: true }, bend('drawn', 2, 0)],
                },
            ],
            frameAtBeat,
        });

        expect(points.map(({ beat, channel, channelScoped }) => ({ beat, channel, channelScoped }))).toEqual([
            { beat: 1, channel: 2, channelScoped: true },
            { beat: 2, channel: 0, channelScoped: false },
        ]);
    });

    it('plays a trimmed head as the untrimmed clip when carried rows of one channel share a beat', () => {
        // An MPE switch-off writes a centred unscoped row and the channel's scoped wheel in one call, on one beat,
        // and the later of them in the list is the one in force. The carry must keep that order, not the order
        // the lanes first appeared in, where the earlier scoped wheel put the scoped lane first.
        const pitchBends = [
            { ...bend('s1', 1, 1_000), channelScoped: true },
            bend('u1', 3, 2_000),
            bend('u2', 5, 0),
            { ...bend('s2', 5, 1_000), channelScoped: true },
        ];
        const heardAt = (clip: { startBeat: number; endBeat: number; midiOffsetBeats: number }) => {
            const points = projectChannelBend({ clips: [{ clip, controlChanges: [], pitchBends }], frameAtBeat });
            const inForce = (channel: number) =>
                points.findLast((point) => point.beat <= 6 && (!point.channelScoped || point.channel === channel))
                    ?.value;
            return { channel0: inForce(0), channel1: inForce(1) };
        };

        const untrimmed = heardAt({ startBeat: 0, endBeat: 10, midiOffsetBeats: 0 });

        expect(untrimmed).toEqual({ channel0: 1_000, channel1: 0 });
        expect(heardAt({ startBeat: 6, endBeat: 10, midiOffsetBeats: 6 })).toEqual(untrimmed);
    });

    it('carries a drawn bend and a later recorded wheel of one channel onto a trimmed head, in recorded order', () => {
        // Keyed by channel alone, the carry kept only the later (scoped) row, so a note of another channel lost the
        // drawn bend it hears on the untrimmed clip.
        const points = projectChannelBend({
            clips: [
                {
                    clip: { startBeat: 3, endBeat: 8, midiOffsetBeats: 3 },
                    controlChanges: [],
                    pitchBends: [{ ...bend('wheel', 2, 8_191), channelScoped: true }, bend('drawn', 1, 4_096)],
                },
            ],
            frameAtBeat,
        });

        expect(
            points.map(({ beat, recordedBeat, value, channelScoped }) => ({ beat, recordedBeat, value, channelScoped }))
        ).toEqual([
            { beat: 3, recordedBeat: 1, value: 4_096, channelScoped: false },
            { beat: 3, recordedBeat: 2, value: 8_191, channelScoped: true },
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

    it('keeps a frozen carried move’s source order across cropped pass occurrences', () => {
        const sourceControlChanges = declareRange(4, 12);
        const points = projectChannelBend({
            clips: [
                {
                    clip: { startBeat: 2, endBeat: 4, midiOffsetBeats: 2 },
                    controlChanges: [],
                    pitchBends: [{ ...bend('carried-first', 2, 8191), sourceRecordedBeat: 5.5 }],
                    sourceControlChanges,
                    sourceBeatOffset: -4,
                },
                {
                    clip: { startBeat: 6, endBeat: 8, midiOffsetBeats: 6 },
                    controlChanges: [],
                    pitchBends: [{ ...bend('carried-second', 6, 8191), sourceRecordedBeat: 5.5 }],
                    sourceControlChanges,
                    sourceBeatOffset: 0,
                },
            ],
            frameAtBeat,
        });

        expect(
            points.map(({ beat, recordedBeat, rangeSemitones }) => ({ beat, recordedBeat, rangeSemitones }))
        ).toEqual([
            { beat: 2, recordedBeat: 1.5, rangeSemitones: 12 },
            { beat: 6, recordedBeat: 5.5, rangeSemitones: 12 },
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

    describe('with a looping clip whose head is cut a loop or more past its anchor', () => {
        type Clip = Parameters<typeof projectChannelBend>[0]['clips'][number]['clip'];
        type Lanes = { controlChanges: readonly MidiCC[]; pitchBends: readonly MidiPitchBend[] };

        // The uncut source: loop [0, 4) of content anchored at timeline 1 and
        // first trimmed to 3, so it plays content 2 at timeline 3. Its pass
        // grid wraps at timeline 5, 9, 13 and 17. Delete Time over [1, 9.5)
        // opens the clip on content 0.5 at timeline 1, 8.5 beats earlier.
        const uncut: Clip = {
            startBeat: 3,
            endBeat: 19,
            midiOffsetBeats: 2,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 1,
        };
        const cutBeat = 9.5;
        const excisedShiftBeats = 8.5;

        /** Delete Time over `[fragmentStartBeat, cutBeat)`, or a split's right fragment when they are equal. */
        function cutHead(clip: Clip, fragmentStartBeat: number, atBeat = cutBeat): Clip {
            return {
                ...clip,
                ...midiFragmentWindowEntry({ ...clip, type: 'midi' }, atBeat, fragmentStartBeat),
                startBeat: fragmentStartBeat,
                endBeat: clip.endBeat - (atBeat - fragmentStartBeat),
            };
        }

        /** `trimClipStart`: the anchor stays, the offset wraps into the loop and every row shifts by the wrap. */
        function trimStart(clip: Clip, lanes: Lanes, startBeat: number): { clip: Clip; lanes: Lanes } {
            const rawOffsetBeats = (clip.midiOffsetBeats ?? 0) + (startBeat - clip.startBeat);
            const midiOffsetBeats = resolveLoopedOffsetBeats({
                offsetBeats: rawOffsetBeats,
                loopEnabled: true,
                clipDurationBeats: clip.endBeat - startBeat,
                configuredLoopLengthBeats: clip.loopLength,
            });
            const shiftBeats = midiOffsetBeats - rawOffsetBeats;
            return {
                clip: { ...clip, startBeat, midiOffsetBeats },
                lanes: {
                    controlChanges: lanes.controlChanges.map((row) => ({ ...row, beat: row.beat + shiftBeats })),
                    pitchBends: lanes.pitchBends.map((row) => ({ ...row, beat: row.beat + shiftBeats })),
                },
            };
        }

        function points(clip: Clip, lanes: Lanes) {
            return projectChannelBend({ clips: [{ clip, ...lanes }], frameAtBeat });
        }

        /**
         * The bend a note on `noteChannel` hears at `beat`, with where it was recorded moved onto the uncut
         * clip's timeline by `shiftBeats`, so a trimmed clip and its source compare directly.
         */
        function heardAt(clip: Clip, lanes: Lanes, beat: number, noteChannel: number, shiftBeats = 0) {
            const inForce = points(clip, lanes).findLast(
                (point) => point.beat <= beat && (!point.channelScoped || point.channel === noteChannel)
            );
            return (
                inForce && {
                    value: inForce.value,
                    rangeSemitones: inForce.rangeSemitones,
                    recordedBeat: inForce.recordedBeat + shiftBeats,
                }
            );
        }

        function onHead(clip: Clip, lanes: Lanes) {
            return points(clip, lanes)
                .filter((point) => point.beat === clip.startBeat)
                .map(({ value, recordedBeat, rangeSemitones, channel }) => ({
                    value,
                    recordedBeat,
                    rangeSemitones,
                    channel,
                }));
        }

        it('begins a head excised mid-pass with the bend the pass before ended on, recorded where that pass played it', () => {
            // Timeline 9.5 of the uncut loop is content 0.5, after the bend at
            // 3.5 of the pass before (timeline 8.5) and before this pass's own
            // row at 1, so that bend is in force there.
            const lanes = { controlChanges: [], pitchBends: [bend('low', 1, -2_000), bend('high', 3.5, 6_000)] };

            expect(heardAt(uncut, lanes, cutBeat, 0)).toEqual({ value: 6_000, rangeSemitones: 2, recordedBeat: 8.5 });
            expect(onHead(cutHead(uncut, 1), lanes)).toEqual([
                { value: 6_000, recordedBeat: 0, rangeSemitones: 2, channel: 0 },
            ]);
        });

        it('bends every channel as the uncut clip does at every beat after the cut, for a split and a start trim alike', () => {
            const lanes: Lanes = {
                controlChanges: declareRange(3, 12),
                pitchBends: [
                    { ...bend('wheel-this-pass', 0.3, 8_191, 1), channelScoped: true },
                    bend('drawn', 2.75, 1_500),
                    { ...bend('wheel-pass-before', 3.5, -4_000, 1), channelScoped: true },
                ],
            };
            const shapes = [
                { name: 'head excised', shiftBeats: excisedShiftBeats, clip: cutHead(uncut, 1), lanes },
                { name: 'split right fragment', shiftBeats: 0, clip: cutHead(uncut, cutBeat), lanes },
                { name: 'start trimmed', shiftBeats: 0, ...trimStart(uncut, lanes, cutBeat) },
            ];

            for (const shape of shapes) {
                for (const beat of [9.5, 9.6, 10.3, 11.1, 12.7, 13.9, 16.35, 18.2]) {
                    for (const noteChannel of [0, 1]) {
                        const trimmedBeat = beat - shape.shiftBeats;
                        expect({
                            shape: shape.name,
                            beat,
                            noteChannel,
                            heard: heardAt(shape.clip, shape.lanes, trimmedBeat, noteChannel, shape.shiftBeats),
                        }).toEqual({
                            shape: shape.name,
                            beat,
                            noteChannel,
                            heard: heardAt(uncut, lanes, beat, noteChannel),
                        });
                    }
                }
            }
        });

        it('posts the pass before ahead of this pass on the head, so a channel’s own later wheel outranks a drawn bend', () => {
            // The drawn bend played at 8.5 in the uncut loop, channel 1's wheel at
            // 9.2: a channel 1 note hears the wheel, any other note the drawn bend.
            const lanes = {
                controlChanges: [],
                pitchBends: [
                    { ...bend('wheel-this-pass', 0.2, 8_191, 1), channelScoped: true },
                    bend('drawn-pass-before', 3.5, 1_500),
                ],
            };
            const trimmed = cutHead(uncut, 1);

            expect(heardAt(trimmed, lanes, 1, 1)?.value).toBe(8_191);
            expect(heardAt(trimmed, lanes, 1, 0)?.value).toBe(1_500);
            expect(heardAt(uncut, lanes, cutBeat, 1)?.value).toBe(8_191);
            expect(heardAt(uncut, lanes, cutBeat, 0)?.value).toBe(1_500);
        });

        it('carries this pass’s row before the cut over the lane’s row from the pass before', () => {
            const lanes = { controlChanges: [], pitchBends: [bend('early', 0.2, 1_000), bend('late', 3.5, 6_000)] };

            expect(onHead(cutHead(uncut, 1), lanes)).toEqual([
                { value: 1_000, recordedBeat: 0.7, rangeSemitones: 2, channel: 0 },
            ]);
        });

        it('plays a bend row exactly on the cut once, never behind the bend the pass before left', () => {
            const lanes = { controlChanges: [], pitchBends: [bend('on-cut', 0.5, 3_000), bend('late', 3.5, 6_000)] };

            expect(onHead(cutHead(uncut, 1), lanes)).toEqual([
                { value: 3_000, recordedBeat: 1, rangeSemitones: 2, channel: 0 },
            ]);
        });

        it('reads a bend from the pass before at the depth declared where it was recorded, not at the cut', () => {
            // ±7 is in force at the cut (content 0.5), ±12 from content 3, so the
            // bend at 3.5 the pass before played sounded at ±12.
            const lanes = {
                controlChanges: [...declareRange(0.2, 7), ...declareRange(3, 12)],
                pitchBends: [bend('late', 3.5, 6_000)],
            };

            expect(heardAt(uncut, lanes, cutBeat, 0)).toEqual({ value: 6_000, rangeSemitones: 12, recordedBeat: 8.5 });
            expect(onHead(cutHead(uncut, 1), lanes)).toEqual([
                { value: 6_000, recordedBeat: 0, rangeSemitones: 12, channel: 0 },
            ]);
        });

        it('carries nothing into a head cut less than a loop past its anchor, as the source played from the anchor', () => {
            // Timeline 2.5 lies in the first pass from the anchor at 1: no pass
            // ended before it, so the bend at 3.5 has not yet played there.
            const lanes = { controlChanges: [], pitchBends: [bend('late', 3.5, 6_000)] };
            const anchoredAtHead: Clip = { ...uncut, startBeat: 1, midiOffsetBeats: 0 };

            expect(heardAt(anchoredAtHead, lanes, 2.5, 0)).toBeUndefined();
            expect(onHead(cutHead(anchoredAtHead, 2.5, 2.5), lanes)).toEqual([]);
        });
    });
});
