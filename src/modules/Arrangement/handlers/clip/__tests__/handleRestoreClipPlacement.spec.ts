import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleRestoreClipPlacement } from '../handleRestoreClipPlacement';

const mocks = vi.hoisted(() => ({
    clipAutomationMoveStateMatches: vi.fn(),
    getTrackStoreState: vi.fn(),
    moveClip: vi.fn<() => boolean>(),
    restoreClipAutomationMoveState: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    clipAutomationMoveStateMatches: mocks.clipAutomationMoveStateMatches,
    restoreClipAutomationMoveState: mocks.restoreClipAutomationMoveState,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/clip/moveClip', () => ({
    moveClip: mocks.moveClip,
}));

const action = {
    type: 'restoreClipPlacement' as const,
    payload: {
        clipId: 'clip-1',
        expected: {
            trackId: 'track-2',
            startBeat: 16,
            endBeat: 24,
            automationLanes: [{ id: 'lane-1', trackId: 'track-2', points: [] }],
        },
        replacement: {
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 10,
            automationLanes: [{ id: 'lane-1', trackId: 'track-1', points: [] }],
        },
    },
};

describe('handleRestoreClipPlacement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clipAutomationMoveStateMatches.mockReturnValue(true);
        mocks.restoreClipAutomationMoveState.mockReturnValue(true);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'track-2',
                    clips: [{ id: 'clip-1', startBeat: 16, endBeat: 24 }],
                },
            ],
        });
    });

    it('restores the replacement placement only when the expected placement still matches', () => {
        mocks.moveClip.mockReturnValueOnce(true);

        expect(handleRestoreClipPlacement.execute(action)).toEqual({ status: 'written' });
        expect(mocks.moveClip).toHaveBeenCalledWith('clip-1', 'track-1', 2, undefined, false);
        expect(mocks.restoreClipAutomationMoveState).toHaveBeenCalledWith(
            'clip-1',
            action.payload.replacement.automationLanes
        );
    });

    it('reports a conflict without writing after an external placement edit', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'track-2',
                    clips: [{ id: 'clip-1', startBeat: 20, endBeat: 28 }],
                },
            ],
        });

        expect(handleRestoreClipPlacement.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.moveClip).not.toHaveBeenCalled();
    });

    it('reports a conflict when clip automation no longer matches the guarded expected state', () => {
        mocks.clipAutomationMoveStateMatches.mockReturnValue(false);

        expect(handleRestoreClipPlacement.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.moveClip).not.toHaveBeenCalled();
    });

    it('reports a conflict when the replacement track is unavailable or the clip became locked', () => {
        mocks.moveClip.mockReturnValue(false);

        expect(handleRestoreClipPlacement.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.restoreClipAutomationMoveState).not.toHaveBeenCalled();
    });

    it('recognizes the exact replacement placement as a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    clips: [{ id: 'clip-1', startBeat: 2, endBeat: 10 }],
                },
            ],
        });
        mocks.clipAutomationMoveStateMatches.mockReturnValue(true);

        expect(handleRestoreClipPlacement.isNoop?.(action)).toBe(true);
        expect(handleRestoreClipPlacement.requiresAbortCompensation).toBe(false);
        expect(handleRestoreClipPlacement.undoable).toBe(false);
    });
});
