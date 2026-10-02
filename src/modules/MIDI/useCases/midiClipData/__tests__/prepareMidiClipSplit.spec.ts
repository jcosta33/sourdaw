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
                { id: 'bend-early', value: 0.2, beat: 1, channel: 0 },
                { id: 'bend-late', value: 0.8, beat: 6, channel: 0 },
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
        expect(plan.nextSource.pitchBends.value).toEqual([{ id: 'bend-early', value: 0.2, beat: 1, channel: 0 }]);
        expect(plan.nextRight.pitchBends.value).toEqual([
            { id: 'pb-split:right:0', value: 0.2, beat: 0, channel: 0 },
            { id: 'pb-split:right:1', value: 0.8, beat: 2, channel: 0 },
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
        expect(mocks.state.value?.ccByClipId.source).toEqual(plan.nextSource.controlChanges.value);
        expect(mocks.state.value?.ccByClipId.right).toEqual(plan.nextRight.controlChanges.value);
        expect(mocks.state.value?.pitchBendByClipId.right).toEqual(plan.nextRight.pitchBends.value);

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
