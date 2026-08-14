import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveSend } from '../handleRemoveSend';

const mocks = vi.hoisted(() => ({
    removeSend: vi.fn(),
    getTrackStoreState: vi.fn<
        () => {
            tracks: { id: string; sends: { busId: string; level: number; preFader: boolean }[] }[];
        } | null
    >(),
}));

vi.mock('../../../useCases/device/sendManagement/removeSend', () => ({
    removeSend: mocks.removeSend,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleRemoveSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes removeSend with the provided payload', () => {
        const finalizeRuntimeEffect = vi.fn();
        const reconcileRuntimeEffect = vi.fn();
        mocks.removeSend.mockReturnValue({
            afterCommit: finalizeRuntimeEffect,
            afterAmbiguousCommit: reconcileRuntimeEffect,
        });
        const result = handleRemoveSend.execute({
            type: 'removeSend',
            payload: { trackId: 't1', busId: 'bus-1' },
        });

        expect(mocks.removeSend).toHaveBeenCalledWith('t1', 'bus-1', { deferRuntimeEffect: true });
        expect(finalizeRuntimeEffect).not.toHaveBeenCalled();
        if (!result || result instanceof Promise) {
            throw new Error('expected a synchronous handler result');
        }
        result.afterCommit?.();
        expect(finalizeRuntimeEffect).toHaveBeenCalledOnce();
        result.afterAmbiguousCommit?.();
        expect(reconcileRuntimeEffect).toHaveBeenCalledOnce();
    });

    it('reports a conflict when the send disappeared before execution', () => {
        mocks.removeSend.mockReturnValue(null);

        const result = handleRemoveSend.execute({
            type: 'removeSend',
            payload: { trackId: 't1', busId: 'bus-1' },
        });

        expect(result).toEqual({ status: 'conflict' });
    });

    it('rejects a conditional remove after the send changed again', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', sends: [{ busId: 'bus-1', level: 0.8, preFader: true }] }],
        });

        const result = handleRemoveSend.execute({
            type: 'removeSend',
            payload: {
                trackId: 't1',
                busId: 'bus-1',
                expectedLevel: 0.5,
                expectedPreFader: true,
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.removeSend).not.toHaveBeenCalled();
    });

    it('provides a description', () => {
        const desc = handleRemoveSend.describe({
            type: 'removeSend',
            payload: { trackId: 't1', busId: 'bus-1' },
        });
        expect(desc.label).toBe('Remove send');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse re-creating the send at its previous level', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', sends: [{ busId: 'bus-1', level: 0.7, preFader: true }] }],
        });

        const desc = handleRemoveSend.describe({
            type: 'removeSend',
            payload: { trackId: 't1', busId: 'bus-1' },
        });

        expect(desc.inverseAction).toEqual({
            type: 'addSend',
            payload: {
                trackId: 't1',
                busId: 'bus-1',
                level: 0.7,
                preFader: true,
                expectedAbsent: true,
            },
        });
    });

    it('is undoable', () => {
        expect(handleRemoveSend.undoable).toBe(true);
    });

    it('certifies only fully guarded removals for divergent reapplication', () => {
        expect(
            handleRemoveSend.canReapplyAfterDivergence?.({
                type: 'removeSend',
                payload: {
                    trackId: 't1',
                    busId: 'bus-1',
                    expectedLevel: 0.5,
                    expectedPreFader: false,
                },
            })
        ).toBe(true);
        expect(
            handleRemoveSend.canReapplyAfterDivergence?.({
                type: 'removeSend',
                payload: { trackId: 't1', busId: 'bus-1', expectedLevel: 0.5 },
            })
        ).toBe(false);
    });
});
