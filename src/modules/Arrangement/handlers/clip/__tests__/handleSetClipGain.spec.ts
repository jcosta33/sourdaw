import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetClipGain } from '../handleSetClipGain';

const mocks = vi.hoisted(() => ({
    setClipGain: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; clips: { id: string; gain: number }[] }[] } | null>(),
}));

vi.mock('../../../useCases/clipEditing/setClipGain', () => ({
    setClipGain: mocks.setClipGain,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetClipGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes setClipGain with the provided payload', () => {
        void handleSetClipGain.execute({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.5 },
        });

        expect(mocks.setClipGain).toHaveBeenCalledWith('c1', 0.5);
    });

    it('provides a description', () => {
        const desc = handleSetClipGain.describe({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.5 },
        });
        expect(desc.label).toBe('Set clip gain');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse restoring the previous gain, guarded by the gain this action writes', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.8 }] }],
        });

        const desc = handleSetClipGain.describe({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.5 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.8, expectedGain: 0.5 },
        });
    });

    it('guards the inverse with the clamped gain the write actually lands on', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.8 }] }],
        });

        const desc = handleSetClipGain.describe({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 7 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.8, expectedGain: 2 },
        });
    });

    it('describes an inverse that is batch-compensable', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.8 }] }],
        });

        const inverse = handleSetClipGain.describe({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.5 },
        }).inverseAction;

        if (inverse?.type !== 'setClipGain') {
            throw new Error('expected a setClipGain inverse');
        }
        expect(handleSetClipGain.canReapplyAfterDivergence?.(inverse)).toBe(true);
    });

    it('is undoable', () => {
        expect(handleSetClipGain.undoable).toBe(true);
    });

    describe('replay guard', () => {
        it('is not batch-compensable when expectedGain is absent', () => {
            expect(
                handleSetClipGain.canReapplyAfterDivergence?.({
                    type: 'setClipGain',
                    payload: { clipId: 'c1', gain: 0.5 },
                })
            ).toBe(false);
        });

        it('is batch-compensable when expectedGain is present', () => {
            expect(
                handleSetClipGain.canReapplyAfterDivergence?.({
                    type: 'setClipGain',
                    payload: { clipId: 'c1', gain: 0.5, expectedGain: 0.8 },
                })
            ).toBe(true);
        });

        it('validate passes through when expectedGain is absent', () => {
            expect(
                handleSetClipGain.validate?.(
                    { type: 'setClipGain', payload: { clipId: 'c1', gain: 0.5 } },
                    { actions: [], actionIndex: 0 }
                )
            ).toBe(true);
        });

        it('validate rejects a diverged gain', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.3 }] }],
            });

            expect(
                handleSetClipGain.validate?.(
                    { type: 'setClipGain', payload: { clipId: 'c1', gain: 0.5, expectedGain: 0.8 } },
                    { actions: [], actionIndex: 0 }
                )
            ).toBe(false);
        });

        it('validate accepts a matching gain', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.8 }] }],
            });

            expect(
                handleSetClipGain.validate?.(
                    { type: 'setClipGain', payload: { clipId: 'c1', gain: 0.5, expectedGain: 0.8 } },
                    { actions: [], actionIndex: 0 }
                )
            ).toBe(true);
        });

        it('validate rejects when the clip no longer exists', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            expect(
                handleSetClipGain.validate?.(
                    { type: 'setClipGain', payload: { clipId: 'c1', gain: 0.5, expectedGain: 0.8 } },
                    { actions: [], actionIndex: 0 }
                )
            ).toBe(false);
        });

        it('execute reports a conflict when the gain diverged from expectedGain', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.3 }] }],
            });

            const result = handleSetClipGain.execute({
                type: 'setClipGain',
                payload: { clipId: 'c1', gain: 0.5, expectedGain: 0.8 },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.setClipGain).not.toHaveBeenCalled();
        });

        it('execute writes when the gain matches expectedGain', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.8 }] }],
            });

            void handleSetClipGain.execute({
                type: 'setClipGain',
                payload: { clipId: 'c1', gain: 0.5, expectedGain: 0.8 },
            });

            expect(mocks.setClipGain).toHaveBeenCalledWith('c1', 0.5);
        });
    });
});
