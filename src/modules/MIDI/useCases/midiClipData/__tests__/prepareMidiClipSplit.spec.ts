import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SEQUENCER_TICK_BEATS } from '../../../models/SequencerTick';
import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => {
    const state: { value: MidiStoreStateInput | null } = { value: null };
    return { state };
});

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.state.value;
        },
        set: vi.fn((next: MidiStoreStateInput | null) => {
            mocks.state.value = next;
        }),
    },
}));

const { addMidiCC } = await import('../../midiEvent/addMidiCC');
const { removeMidiCC } = await import('../../midiEvent/removeMidiCC');
const { restoreMidiCCPoints } = await import('../../midiEvent/restoreMidiCCPoints');
const { createStoredBendRangeReader } = await import('../createStoredBendRangeReader');
const { prepareMidiClipSplit } = await import('../prepareMidiClipSplit');
const { projectChannelBend } = await import('../projectChannelBend');
const { restoreMidiClipSplitState } = await import('../restoreMidiClipSplitState');

function createMidiState(): MidiStoreStateInput {
    return {
        probabilitySeed: 7,
        notesByClipId: {
            source: [{ id: 'held', pitch: 60, startBeat: 2, duration: 4, velocity: 100 }],
        },
        ccByClipId: {
            source: [
                { id: 'down', controller: 64, value: 127, beat: 1, channel: 0 },
                { id: 'up', controller: 64, value: 0, beat: 3, channel: 0 },
                { id: 'down-again', controller: 64, value: 127, beat: 5, channel: 0 },
            ],
        },
        pitchBendByClipId: {
            source: [
                { id: 'bend-early', value: 1600, beat: 1, channel: 0 },
                { id: 'bend-late', value: 6500, beat: 6, channel: 0 },
            ],
        },
    };
}

function splitInput(targetNoteIds?: readonly string[]) {
    return { sourceClipId: 'source', rightClipId: 'right', splitBeat: 4, splitNotes: true, targetNoteIds };
}

function requirePlan(plan: ReturnType<typeof prepareMidiClipSplit>): NonNullable<typeof plan> {
    if (!plan) {
        throw new Error('expected a split plan');
    }
    return plan;
}

describe('prepareMidiClipSplit controllers and pitch bends', () => {
    beforeEach(() => {
        mocks.state.value = createMidiState();
    });

    it('plans the left and right controller and pitch bend rows from the transformed state', () => {
        const plan = requirePlan(prepareMidiClipSplit(splitInput()));

        expect(plan.nextSource.controlChanges).toEqual({
            present: true,
            value: [
                { id: 'down', controller: 64, value: 127, beat: 1, channel: 0 },
                { id: 'up', controller: 64, value: 0, beat: 3, channel: 0 },
            ],
        });
        expect(plan.nextRight.controlChanges).toEqual({
            present: true,
            value: [
                { id: 'cc-split:right:1', controller: 64, value: 0, beat: 0, channel: 0 },
                { id: 'cc-split:right:2', controller: 64, value: 127, beat: 1, channel: 0 },
            ],
        });
        expect(plan.nextSource.pitchBends.value).toEqual([{ id: 'bend-early', value: 1600, beat: 1, channel: 0 }]);
        expect(plan.nextRight.pitchBends.value).toEqual([
            { id: 'pb-split:right:0', value: 1600, beat: 0, channel: 0 },
            { id: 'pb-split:right:1', value: 6500, beat: 2, channel: 0 },
        ]);
        expect(plan.previousSource.controlChanges.value).toHaveLength(3);
        expect(plan.previousRight.controlChanges).toEqual({ present: false, value: [] });
    });

    it('undoes the split to the original controller rows and redoes it with the same ids', () => {
        const original = createMidiState();
        const plan = requirePlan(prepareMidiClipSplit(splitInput()));
        const restoreInput = {
            sourceClipId: 'source',
            rightClipId: 'right',
            expectedSource: plan.previousSource,
            expectedRight: plan.previousRight,
            replacementSource: plan.nextSource,
            replacementRight: plan.nextRight,
        };

        expect(restoreMidiClipSplitState(restoreInput)).toBe(true);
        expect(mocks.state.value?.ccByClipId.source?.map((event) => event.id)).toEqual(['down', 'up']);
        expect(mocks.state.value?.ccByClipId.right?.map((event) => event.id)).toEqual([
            'cc-split:right:1',
            'cc-split:right:2',
        ]);
        expect(mocks.state.value?.pitchBendByClipId.source?.map((event) => event.id)).toEqual(['bend-early']);
        expect(mocks.state.value?.pitchBendByClipId.right?.map((event) => event.id)).toEqual([
            'pb-split:right:0',
            'pb-split:right:1',
        ]);

        expect(
            restoreMidiClipSplitState({
                ...restoreInput,
                expectedSource: plan.nextSource,
                expectedRight: plan.nextRight,
                replacementSource: plan.previousSource,
                replacementRight: plan.previousRight,
            })
        ).toBe(true);
        expect(mocks.state.value?.ccByClipId).toEqual(original.ccByClipId);
        expect(mocks.state.value?.pitchBendByClipId).toEqual(original.pitchBendByClipId);
        expect(mocks.state.value?.notesByClipId).toEqual(original.notesByClipId);

        const replayed = requirePlan(prepareMidiClipSplit(splitInput(plan.targetNoteIds)));
        expect(replayed.nextSource).toEqual(plan.nextSource);
        expect(replayed.nextRight).toEqual(plan.nextRight);
    });

    it('plans no change to controller rows when notes are not split', () => {
        const plan = requirePlan(prepareMidiClipSplit({ ...splitInput(), splitNotes: false }));

        expect(plan.nextSource).toEqual(plan.previousSource);
        expect(plan.nextRight).toEqual(plan.previousRight);
    });
});

describe('prepareMidiClipSplit bend range', () => {
    type Controller = { id: string; beat: number; controller: number; value: number; channel: number };
    type Bend = { id: string; beat: number; value: number; channel: number };

    function controller(id: string, beat: number, cc: number, value: number): Controller {
        return { id, beat, controller: cc, value, channel: 0 };
    }

    /** RPN 0 = 12, then the Null RPN a controller sends after a data entry. */
    const NULL_TERMINATED_RANGE = [
        controller('rpn-msb', 0.5, 101, 0),
        controller('rpn-lsb', 0.75, 100, 0),
        controller('data-msb', 1, 6, 12),
        controller('data-lsb', 1.25, 38, 0),
        controller('null-msb', 1.5, 101, 127),
        controller('null-lsb', 1.75, 100, 127),
    ];

    /** The depth the channel bend plays its first move under, on a clip that starts at its own origin. */
    function rangeOfFirstBend(controlChanges: readonly Controller[], pitchBends: readonly Bend[]) {
        const [point] = projectChannelBend({
            clips: [{ clip: { startBeat: 0, endBeat: 16 }, controlChanges, pitchBends }],
            frameAtBeat: (beat) => beat * 24_000,
        });
        return point?.rangeSemitones;
    }

    beforeEach(() => {
        mocks.state.value = {
            probabilitySeed: 7,
            notesByClipId: {},
            ccByClipId: { source: NULL_TERMINATED_RANGE },
            pitchBendByClipId: { source: [{ id: 'bend-late', value: 6500, beat: 6, channel: 0 }] },
        };
    });

    it('plays a bend of the right half at the range the take declared before the cut, though the Null RPN closed it', () => {
        const plan = requirePlan(prepareMidiClipSplit(splitInput()));

        expect(rangeOfFirstBend(plan.nextRight.controlChanges.value, plan.nextRight.pitchBends.value)).toBe(12);
        // The unsplit clip plays the same bend under the same range.
        expect(rangeOfFirstBend(NULL_TERMINATED_RANGE, [{ id: 'bend', value: 6500, beat: 6, channel: 0 }])).toBe(12);
    });

    describe('a bend carried onto the right half’s origin', () => {
        /** RPN 0 = `semitones`, every message on `beat`. */
        function rangeAt(prefix: string, beat: number, semitones: number): Controller[] {
            return [
                controller(`${prefix}-msb`, beat, 101, 0),
                controller(`${prefix}-lsb`, beat, 100, 0),
                controller(`${prefix}-data-msb`, beat, 6, semitones),
                controller(`${prefix}-data-lsb`, beat, 38, 0),
            ];
        }

        const recordedUnderTwelve = [...rangeAt('twelve', 0.1, 12), ...rangeAt('two', 1.3, 2)];
        const carried: Bend = { id: 'carried', value: 8191, beat: 1.2, channel: 0 };

        type Clip = { startBeat: number; endBeat: number; midiOffsetBeats?: number };

        function rangesPlayed(clip: Clip, controlChanges: readonly Controller[], pitchBends: readonly Bend[]) {
            return projectChannelBend({
                clips: [{ clip, controlChanges, pitchBends }],
                frameAtBeat: (beat) => beat * 24_000,
            }).map(({ beat, rangeSemitones }) => ({ beat, rangeSemitones }));
        }

        function splitAtTwo(controlChanges: readonly Controller[], pitchBends: readonly Bend[]) {
            mocks.state.value = {
                probabilitySeed: 7,
                notesByClipId: {},
                ccByClipId: { source: [...controlChanges] },
                pitchBendByClipId: { source: [...pitchBends] },
            };
            return requirePlan(
                prepareMidiClipSplit({ sourceClipId: 'source', rightClipId: 'right', splitBeat: 2, splitNotes: true })
            );
        }

        it.each([
            { name: 'trimmed to start after the row', source: { startBeat: 0, endBeat: 2.65, midiOffsetBeats: 1.35 } },
            { name: 'untrimmed', source: { startBeat: 0, endBeat: 4 } },
        ])('plays it at the range its row was recorded under, as the $name clip did', ({ source }) => {
            const plan = splitAtTwo(recordedUnderTwelve, [carried]);
            const cut = 2 - (source.midiOffsetBeats ?? 0);
            const right = { startBeat: cut, endBeat: source.endBeat };

            expect(rangesPlayed(source, recordedUnderTwelve, [carried]).at(-1)?.rangeSemitones).toBe(12);
            expect(rangesPlayed(right, plan.nextRight.controlChanges.value, plan.nextRight.pitchBends.value)).toEqual([
                { beat: cut, rangeSemitones: 12 },
            ]);
        });

        it('plays the right half’s own later rows at the range in force at the cut', () => {
            const dataEntry = controller('data-entry-after', 3, 6, 5);
            const bends = [
                carried,
                { id: 'later', value: 4096, beat: 2.5, channel: 0 },
                { id: 'after-data-entry', value: 4096, beat: 3.5, channel: 0 },
            ];
            const plan = splitAtTwo([...recordedUnderTwelve, dataEntry], bends);

            expect(rangesPlayed({ startBeat: 0, endBeat: 4 }, [...recordedUnderTwelve, dataEntry], bends)).toEqual([
                { beat: 1.2, rangeSemitones: 12 },
                { beat: 2.5, rangeSemitones: 2 },
                { beat: 3.5, rangeSemitones: 5 },
            ]);
            expect(
                rangesPlayed(
                    { startBeat: 2, endBeat: 4 },
                    plan.nextRight.controlChanges.value,
                    plan.nextRight.pitchBends.value
                )
            ).toEqual([
                { beat: 2, rangeSemitones: 12 },
                { beat: 2.5, rangeSemitones: 2 },
                { beat: 3.5, rangeSemitones: 5 },
            ]);
        });

        it.each([
            { name: 'no row of its own after the origin', controlChanges: recordedUnderTwelve },
            {
                name: 'its first row of its own after the added bend',
                controlChanges: [...recordedUnderTwelve, controller('volume-after', 3.5, 7, 100)],
            },
        ])(
            'plays a bend added after the carried one at the range in force at the cut, with $name',
            ({ controlChanges }) => {
                const plan = splitAtTwo(controlChanges, [carried]);
                const added: Bend = { id: 'added', value: 4096, beat: 1, channel: 0 };

                expect(
                    rangesPlayed({ startBeat: 2, endBeat: 4 }, plan.nextRight.controlChanges.value, [
                        ...plan.nextRight.pitchBends.value,
                        added,
                    ])
                ).toEqual([
                    { beat: 2, rangeSemitones: 12 },
                    { beat: 3, rangeSemitones: 2 },
                ]);
            }
        );

        it.each([
            { name: 'two ticks after the origin', addedBeat: 2 * SEQUENCER_TICK_BEATS },
            { name: 'half a beat after the origin', addedBeat: 0.5 },
            { name: 'just under a beat after the origin', addedBeat: 1 - SEQUENCER_TICK_BEATS },
        ])('reads the state at the cut for a bend drawn $name', ({ addedBeat }) => {
            const plan = splitAtTwo(recordedUnderTwelve, [carried]);
            const added: Bend = { id: 'added', value: 4096, beat: addedBeat, channel: 0 };

            expect(
                rangesPlayed({ startBeat: 2, endBeat: 4 }, plan.nextRight.controlChanges.value, [
                    ...plan.nextRight.pitchBends.value,
                    added,
                ])
            ).toEqual([
                { beat: 2, rangeSemitones: 12 },
                { beat: 2 + addedBeat, rangeSemitones: 2 },
            ]);
        });

        describe('a range set by hand on the right half’s origin', () => {
            /** The right half of the cut, as the store holds it before the hand edit. */
            function storeRightHalf(controlChanges: readonly Controller[] = recordedUnderTwelve) {
                const plan = splitAtTwo(controlChanges, [carried]);
                mocks.state.value = {
                    probabilitySeed: 7,
                    notesByClipId: {},
                    ccByClipId: { right: [...plan.nextRight.controlChanges.value] },
                    pitchBendByClipId: { right: [...plan.nextRight.pitchBends.value] },
                };
            }

            function storedRows() {
                return mocks.state.value?.ccByClipId.right ?? [];
            }

            it('governs a bend drawn after it, in place of the state at the cut', () => {
                storeRightHalf();

                addMidiCC('right', 6, 7, 0, 0);

                expect(createStoredBendRangeReader(storedRows())(0, 1)).toBe(7);
                expect(createStoredBendRangeReader(storedRows())(0, SEQUENCER_TICK_BEATS * 2)).toBe(7);
            });

            it.each([
                {
                    name: 'a Null RPN, as a keyboard leaves it after a data entry',
                    selected: (beat: number) => [
                        controller(`null-msb-${beat}`, beat, 101, 127),
                        controller(`null-lsb-${beat}`, beat, 100, 127),
                    ],
                },
                {
                    name: 'an NRPN',
                    selected: (beat: number) => [
                        controller(`nrpn-msb-${beat}`, beat, 99, 1),
                        controller(`nrpn-lsb-${beat}`, beat, 98, 1),
                    ],
                },
            ])(
                'keeps the state at the cut for a Data Entry on the origin that the state machine ignores, with $name selected there',
                ({ selected }) => {
                    storeRightHalf([
                        ...rangeAt('twelve', 0.1, 12),
                        ...selected(0.1),
                        ...rangeAt('two', 1.3, 2),
                        ...selected(1.3),
                    ]);
                    const returns = storedRows().filter(({ id }) => id.includes('rpn-after-carried'));

                    addMidiCC('right', 6, 7, 0, 0);

                    expect(returns.length).toBeGreaterThan(0);
                    expect(createStoredBendRangeReader(storedRows())(0, 1)).toBe(2);
                    expect(storedRows().filter(({ id }) => id.includes('rpn-after-carried'))).toEqual(returns);
                }
            );

            it('leaves the state at the cut for a bend drawn after a hand edit on another channel', () => {
                storeRightHalf();

                addMidiCC('right', 6, 7, 0, 1);

                expect(createStoredBendRangeReader(storedRows())(0, 1)).toBe(2);
            });

            it.each([
                { name: 'an RPN MSB select', controller: 101, value: 127 },
                { name: 'an RPN LSB select', controller: 100, value: 0 },
                { name: 'an NRPN MSB select', controller: 99, value: 1 },
                { name: 'an NRPN LSB select', controller: 98, value: 1 },
                { name: 'a Null RPN half', controller: 100, value: 127 },
                { name: 'a Data Entry LSB', controller: 38, value: 0 },
            ])(
                'leaves the state at the cut for a bend drawn after $name on the origin, which sets no range',
                ({ controller: cc, value }) => {
                    storeRightHalf();

                    addMidiCC('right', cc, value, 0, 0);

                    expect(createStoredBendRangeReader(storedRows())(0, 1)).toBe(2);
                }
            );

            it('reads the range before the hand edit again after undo, with a return pulled ahead of the clip’s own first row', () => {
                const ownFirstRow = controller('data-entry-first', 2 + SEQUENCER_TICK_BEATS / 2, 6, 5);
                storeRightHalf([...recordedUnderTwelve, ownFirstRow]);
                const before = [...storedRows()];
                const rangeBefore = createStoredBendRangeReader(before)(0, 1);

                const edit = addMidiCC('right', 6, 7, 0, 0);
                const remaining = new Set(storedRows().map(({ id }) => id));
                const displaced = before.filter(({ id }) => !remaining.has(id));
                removeMidiCC('right', edit.id);
                restoreMidiCCPoints('right', displaced, before);

                expect(rangeBefore).toBe(5);
                expect(displaced.some(({ id }) => id.includes('rpn-after-carried'))).toBe(true);
                expect(createStoredBendRangeReader(storedRows())(0, 1)).toBe(rangeBefore);
                expect(storedRows().map(({ id }) => id)).toEqual(before.map(({ id }) => id));
            });

            it('leaves the state at the cut for a bend drawn after a hand edit that sets no registered parameter', () => {
                storeRightHalf();

                addMidiCC('right', 7, 100, 0, 0);

                expect(createStoredBendRangeReader(storedRows())(0, 1)).toBe(2);
            });

            it('leaves the state at the cut for a bend drawn after a hand edit a beat past the origin', () => {
                storeRightHalf();

                addMidiCC('right', 6, 7, 1, 0);

                expect(createStoredBendRangeReader(storedRows())(0, 0.5)).toBe(2);
                expect(createStoredBendRangeReader(storedRows())(0, 1)).toBe(7);
            });
        });

        it('returns to the state at the cut ahead of a Data Entry of its own on the beat the return takes', () => {
            const controlChanges = [
                ...recordedUnderTwelve,
                controller('data-entry-first', 2 + SEQUENCER_TICK_BEATS / 2, 6, 5),
            ];
            const bends = [carried, { id: 'after-data-entry', value: 4096, beat: 3, channel: 0 }];
            const plan = splitAtTwo(controlChanges, bends);

            expect(rangesPlayed({ startBeat: 0, endBeat: 4 }, controlChanges, bends)).toEqual([
                { beat: 1.2, rangeSemitones: 12 },
                { beat: 3, rangeSemitones: 5 },
            ]);
            expect(
                rangesPlayed(
                    { startBeat: 2, endBeat: 4 },
                    plan.nextRight.controlChanges.value,
                    plan.nextRight.pitchBends.value
                )
            ).toEqual([
                { beat: 2, rangeSemitones: 12 },
                { beat: 3, rangeSemitones: 5 },
            ]);
        });

        it.each([
            {
                name: 'a bend',
                controlChanges: recordedUnderTwelve,
                pitchBends: [carried, { id: 'own', value: 4096, beat: 2 + 1e-12, channel: 0 }],
                range: 2,
            },
            {
                name: 'a Data Entry',
                controlChanges: [...recordedUnderTwelve, controller('own-data-entry', 2 + 1e-12, 6, 5)],
                pitchBends: [carried, { id: 'later', value: 4096, beat: 3, channel: 0 }],
                range: 5,
            },
        ])(
            'reads the state in force at the cut for $name of its own within the same-beat tolerance of the cut',
            ({ controlChanges, pitchBends, range }) => {
                const plan = splitAtTwo(controlChanges, pitchBends);

                expect(
                    rangesPlayed({ startBeat: 0, endBeat: 4 }, controlChanges, pitchBends).at(-1)?.rangeSemitones
                ).toBe(range);
                expect(
                    rangesPlayed(
                        { startBeat: 2, endBeat: 4 },
                        plan.nextRight.controlChanges.value,
                        plan.nextRight.pitchBends.value
                    ).at(-1)?.rangeSemitones
                ).toBe(range);
            }
        );

        it('adds nothing for a carried bend recorded under the state in force at the cut', () => {
            const rangeTwelve = rangeAt('twelve', 0.1, 12);
            const withoutBend = splitAtTwo(rangeTwelve, []);

            const plan = splitAtTwo(rangeTwelve, [carried]);

            expect(plan.nextRight.controlChanges).toEqual(withoutBend.nextRight.controlChanges);
            expect(plan.nextRight.controlChanges.value.map((row) => row.controller)).toEqual([101, 100, 6, 38]);
        });

        it('plans the same rows again on a replay with the ids it was planned under', () => {
            const plan = splitAtTwo(recordedUnderTwelve, [carried]);

            const replayed = requirePlan(
                prepareMidiClipSplit({
                    sourceClipId: 'source',
                    rightClipId: 'right',
                    splitBeat: 2,
                    splitNotes: true,
                    targetNoteIds: plan.targetNoteIds,
                })
            );

            expect(replayed.nextRight).toEqual(plan.nextRight);
            expect(new Set(plan.nextRight.controlChanges.value.map((row) => row.id)).size).toBe(
                plan.nextRight.controlChanges.value.length
            );
        });
    });

    it('plans the same declaration rows again on a replay with the ids it was planned under', () => {
        const plan = requirePlan(prepareMidiClipSplit(splitInput()));

        const replayed = requirePlan(prepareMidiClipSplit(splitInput(plan.targetNoteIds)));

        expect(replayed.nextRight.controlChanges).toEqual(plan.nextRight.controlChanges);
        expect(plan.nextRight.controlChanges.value.map((row) => row.controller)).toEqual([101, 100, 6, 38, 101, 100]);
    });
});
