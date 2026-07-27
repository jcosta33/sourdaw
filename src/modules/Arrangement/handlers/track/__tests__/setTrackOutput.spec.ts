import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackOutput } from '../setTrackOutput';

const mocks = vi.hoisted(() => ({
    setTrackOutput: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/setTrackOutput', () => ({
    setTrackOutput: mocks.setTrackOutput,
}));
vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetTrackOutput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes setTrackOutput with the provided payload', () => {
        const finalizeRuntimeEffect = vi.fn();
        const reconcileRuntimeEffect = vi.fn();
        mocks.setTrackOutput.mockReturnValue({
            afterCommit: finalizeRuntimeEffect,
            afterAmbiguousCommit: reconcileRuntimeEffect,
        });
        const result = handleSetTrackOutput.execute({
            type: 'setTrackOutput',
            payload: { trackId: 't1', outputId: 'main' },
        });

        expect(mocks.setTrackOutput).toHaveBeenCalledWith('t1', 'main', { deferRuntimeEffect: true });
        expect(finalizeRuntimeEffect).not.toHaveBeenCalled();
        if (!result || result instanceof Promise) {
            throw new Error('expected a synchronous handler result');
        }
        result.afterCommit?.();
        expect(finalizeRuntimeEffect).toHaveBeenCalledOnce();
        result.afterAmbiguousCommit?.();
        expect(reconcileRuntimeEffect).toHaveBeenCalledOnce();
    });

    it('reports a conflict when output routing is rejected', () => {
        mocks.setTrackOutput.mockReturnValue(null);

        const result = handleSetTrackOutput.execute({
            type: 'setTrackOutput',
            payload: { trackId: 't1', outputId: 'vca-1' },
        });

        expect(result).toEqual({ status: 'conflict' });
    });

    it('provides a description', () => {
        const desc = handleSetTrackOutput.describe({
            type: 'setTrackOutput',
            payload: { trackId: 't1', outputId: 'main' },
        });
        expect(desc.label).toBe('Set track output');
        expect(desc.inverseAction).toBeNull();
    });

    it('captures the prior output and detects an unchanged route', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', outputId: 'master' }],
        });
        const action = {
            type: 'setTrackOutput',
            payload: { trackId: 't1', outputId: 'bus-1' },
        } as const;

        expect(handleSetTrackOutput.describe(action).inverseAction).toEqual({
            type: 'setTrackOutput',
            payload: { trackId: 't1', outputId: 'master', expectedOutputId: 'bus-1' },
        });
        expect(
            handleSetTrackOutput.isNoop?.({
                type: 'setTrackOutput',
                payload: { trackId: 't1', outputId: 'master' },
            })
        ).toBe(true);
    });

    it('rejects a conditional inverse after the route changed again', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', outputId: 'bus-2' }],
        });

        const result = handleSetTrackOutput.execute({
            type: 'setTrackOutput',
            payload: { trackId: 't1', outputId: 'master', expectedOutputId: 'bus-1' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setTrackOutput).not.toHaveBeenCalled();
    });

    it('is undoable', () => {
        expect(handleSetTrackOutput.undoable).toBe(true);
    });
});
