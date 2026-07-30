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

    it('omits the inverse when the track does not exist', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        const desc = handleSetAutomationMode.describe({
            type: 'setAutomationMode',
            payload: { trackId: 'missing', mode: 'touch' },
        });

        expect(desc.inverseAction).toBeNull();
        expect(
            handleSetAutomationMode.isNoop?.({
                type: 'setAutomationMode',
                payload: { trackId: 'missing', mode: 'touch' },
            })
        ).toBe(true);
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

        expect(handleSetAutomationMode.isNoop?.(staleInverse)).toBe(false);
        expect(handleSetAutomationMode.execute(staleInverse)).toEqual({ status: 'conflict' });
        expect(mocks.setAutomationMode).not.toHaveBeenCalled();
    });

    it('is undoable and relies on transaction rollback for aborted batches', () => {
        expect(handleSetAutomationMode.undoable).toBe(true);
        expect(handleSetAutomationMode.requiresAbortCompensation).toBe(false);
    });
});
