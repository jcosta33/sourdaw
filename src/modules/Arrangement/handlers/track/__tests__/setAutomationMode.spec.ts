import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetAutomationMode } from '../setAutomationMode';

const mocks = vi.hoisted(() => ({
    setAutomationMode: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/setAutomationMode', () => ({
    setAutomationMode: mocks.setAutomationMode,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetAutomationMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setAutomationMode with the provided payload', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', automationMode: 'read' }],
        });
        void handleSetAutomationMode.execute({
            type: 'setAutomationMode',
            payload: { trackId: 't1', mode: 'write' },
        });

        expect(mocks.setAutomationMode).toHaveBeenCalledWith('t1', 'write');
    });

    it('provides a description and inverse reflecting the mode transition', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', automationMode: 'read' }],
        });

        const desc = handleSetAutomationMode.describe({
            type: 'setAutomationMode',
            payload: { trackId: 't1', mode: 'touch' },
        });

        expect(desc).toEqual({
            label: 'Set automation mode: touch',
            inverseAction: {
                type: 'setAutomationMode',
                payload: { trackId: 't1', mode: 'read', expectedMode: 'touch' },
            },
        });
    });

    it('describes an inverse from the mode planned by earlier actions in the batch', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', automationMode: 'read' }],
        });
        const writeAction = {
            type: 'setAutomationMode' as const,
            payload: { trackId: 't1', mode: 'write' as const },
        };
        const touchAction = {
            type: 'setAutomationMode' as const,
            payload: { trackId: 't1', mode: 'touch' as const, expectedMode: 'write' as const },
        };

        const desc = handleSetAutomationMode.describe(touchAction, {
            actions: [writeAction, touchAction],
            actionIndex: 1,
        });

        expect(desc.inverseAction).toEqual({
            type: 'setAutomationMode',
            payload: { trackId: 't1', mode: 'write', expectedMode: 'touch' },
        });
    });

    it('omits the inverse when the track does not exist', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        const action = {
            type: 'setAutomationMode' as const,
            payload: { trackId: 'missing', mode: 'touch' as const },
        };

        const desc = handleSetAutomationMode.describe(action);

        expect(
            handleSetAutomationMode.validate?.(action, {
                actions: [action],
                actionIndex: 0,
            })
        ).toBe(false);
        expect(desc.inverseAction).toBeNull();
        expect(handleSetAutomationMode.isNoop?.(action)).toBe(true);
    });

    it('is a no-op when the requested mode is already active', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', automationMode: 'touch' }],
        });

        expect(
            handleSetAutomationMode.isNoop?.({
                type: 'setAutomationMode',
                payload: { trackId: 't1', mode: 'touch' },
            })
        ).toBe(true);
        expect(
            handleSetAutomationMode.isNoop?.({
                type: 'setAutomationMode',
                payload: { trackId: 't1', mode: 'write' },
            })
        ).toBe(false);
    });

    it('returns a conflict instead of overwriting a newer automation mode during replay', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', automationMode: 'latch' }],
        });
        const staleInverse = {
            type: 'setAutomationMode' as const,
            payload: { trackId: 't1', mode: 'read' as const, expectedMode: 'write' as const },
        };

        expect(
            handleSetAutomationMode.validate?.(staleInverse, {
                actions: [staleInverse],
                actionIndex: 0,
            })
        ).toBe(false);
        expect(handleSetAutomationMode.isNoop?.(staleInverse)).toBe(false);
        expect(handleSetAutomationMode.execute(staleInverse)).toEqual({ status: 'conflict' });
        expect(mocks.setAutomationMode).not.toHaveBeenCalled();
    });

    it('validates an ordinary forward action against the current track state', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', automationMode: 'read' }],
        });
        const action = {
            type: 'setAutomationMode' as const,
            payload: { trackId: 't1', mode: 'write' as const },
        };

        expect(
            handleSetAutomationMode.validate?.(action, {
                actions: [action],
                actionIndex: 0,
            })
        ).toBe(true);
    });

    it('declares only expected-state-guarded actions safe to reapply after divergence', () => {
        expect(
            handleSetAutomationMode.canReapplyAfterDivergence?.({
                type: 'setAutomationMode',
                payload: { trackId: 't1', mode: 'read', expectedMode: 'write' },
            })
        ).toBe(true);
        expect(
            handleSetAutomationMode.canReapplyAfterDivergence?.({
                type: 'setAutomationMode',
                payload: { trackId: 't1', mode: 'write' },
            })
        ).toBe(false);
    });

    it('is undoable and relies on transaction rollback for aborted batches', () => {
        expect(handleSetAutomationMode.undoable).toBe(true);
        expect(handleSetAutomationMode.requiresAbortCompensation).toBe(false);
    });
});
