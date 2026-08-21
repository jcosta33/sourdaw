import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCutClip } from '../handleCutClip';

const mocks = vi.hoisted(() => ({
    cutSelectedClip: vi.fn(),
    captureTrackClipStates: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
    clipSelectionStoreValue: null as { selectedClipId: string | null; selectedClipIds: string[] } | null,
}));

vi.mock('../../../useCases/clipboard/cutSelectedClip', () => ({
    cutSelectedClip: mocks.cutSelectedClip,
}));

vi.mock('../../../useCases/captureTrackClipStates', () => ({
    captureTrackClipStates: mocks.captureTrackClipStates,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

vi.mock('../../../stores/clipSelectionStore', () => ({
    clipSelectionStore: {
        get value() {
            return mocks.clipSelectionStoreValue;
        },
    },
}));

describe('handleCutClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cutSelectedClip.mockReturnValue(true);
        mocks.clipSelectionStoreValue = null;
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId: string }) => ({
            status: 'eligible',
            trackId: `track-for-${input.clipId}`,
        }));
    });

    describe('execute', () => {
        it('returns written only when cutSelectedClip writes', () => {
            expect(handleCutClip.execute({ type: 'cutClip' })).toEqual({ status: 'written' });
            expect(mocks.cutSelectedClip).toHaveBeenCalledTimes(1);

            mocks.cutSelectedClip.mockReturnValue(false);
            expect(handleCutClip.execute({ type: 'cutClip' })).toEqual({ status: 'no-write' });
        });
    });

    describe('describe', () => {
        it('emits a null inverse action when there is no eligible selection', () => {
            mocks.clipSelectionStoreValue = { selectedClipId: null, selectedClipIds: [] };

            const desc = handleCutClip.describe({ type: 'cutClip' });

            expect(desc.label).toBe('Cut clip');
            expect(desc.inverseAction).toBeNull();
            expect(mocks.captureTrackClipStates).not.toHaveBeenCalled();
        });

        it('captures the pre-cut state for every distinct track touched by the selection', () => {
            mocks.clipSelectionStoreValue = { selectedClipId: null, selectedClipIds: ['c1', 'c2'] };
            mocks.resolveEligibleClipWriteTarget.mockImplementation(() => ({
                status: 'eligible',
                trackId: 'shared-track',
            }));
            const preCutState = [
                {
                    trackId: 'shared-track',
                    clips: [],
                    midiNotesByClipId: {},
                    midiCcByClipId: {},
                    midiPitchBendByClipId: {},
                },
            ];
            mocks.captureTrackClipStates.mockReturnValue(preCutState);

            const desc = handleCutClip.describe({ type: 'cutClip' });

            expect(mocks.captureTrackClipStates).toHaveBeenCalledWith(['shared-track']);
            if (!desc.inverseAction || desc.inverseAction.type !== 'restoreTrackClipStates') {
                throw new Error('expected a restoreTrackClipStates inverse action');
            }
            expect(desc.inverseAction.payload.replacement).toBe(preCutState);
            expect(desc.inverseAction.payload.expected).toEqual([]);
        });
    });

    it('round-trips: the inverse restores the pre-cut clips, and redo re-applies the post-cut clips', () => {
        mocks.clipSelectionStoreValue = { selectedClipId: 'c1', selectedClipIds: [] };
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1' });
        const preCutState = [
            {
                trackId: 't1',
                clips: [{ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 }],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
        ];
        const postCutState = [
            { trackId: 't1', clips: [], midiNotesByClipId: {}, midiCcByClipId: {}, midiPitchBendByClipId: {} },
        ];
        mocks.captureTrackClipStates.mockReturnValueOnce(preCutState).mockReturnValueOnce(postCutState);

        const action = { type: 'cutClip' as const };
        const desc = handleCutClip.describe(action);
        if (!desc.inverseAction || desc.inverseAction.type !== 'restoreTrackClipStates') {
            throw new Error('expected a restoreTrackClipStates inverse action');
        }
        if (!desc.redoAction || desc.redoAction.type !== 'restoreTrackClipStates') {
            throw new Error('expected a restoreTrackClipStates redo action');
        }

        // Before execute(), the post-cut side is still an empty placeholder.
        expect(desc.inverseAction.payload.expected).toEqual([]);
        expect(desc.redoAction.payload.replacement).toEqual([]);

        const result = handleCutClip.execute(action);

        expect(result).toEqual({ status: 'written' });
        expect(mocks.captureTrackClipStates).toHaveBeenLastCalledWith(['t1']);
        // Same action -> same referenced arrays -> execute() mutating them is
        // visible through the already-emitted describe() result.
        expect(desc.inverseAction.payload.expected).toEqual(postCutState);
        expect(desc.inverseAction.payload.replacement).toEqual(preCutState);
        expect(desc.redoAction.payload.expected).toEqual(preCutState);
        expect(desc.redoAction.payload.replacement).toEqual(postCutState);
    });

    it('is undoable', () => {
        expect(handleCutClip.undoable).toBe(true);
    });
});
