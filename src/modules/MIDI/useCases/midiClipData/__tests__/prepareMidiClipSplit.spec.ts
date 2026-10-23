import { beforeEach, describe, expect, it, vi } from 'vitest';

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
