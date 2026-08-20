import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleRestoreClipStretchState } from '../handleRestoreClipStretchState';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    restoreClipStretchState: vi.fn(),
}));

vi.mock('../../../useCases/clipStretch/restoreClipStretchState', () => ({
    restoreClipStretchState: mocks.restoreClipStretchState,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

const presentState = {
    startBeat: 0,
    endBeat: 8,
    mode: { present: true, value: 'repitch' as const },
    ratio: { present: true, value: 2 },
};

const absentState = {
    startBeat: 0,
    endBeat: 4,
    mode: { present: false, value: 'off' as const },
    ratio: { present: false, value: 1 },
};

describe('handleRestoreClipStretchState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.restoreClipStretchState.mockReturnValue(true);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    clips: [{ id: 'clip-1', startBeat: 0, endBeat: 8, stretchMode: 'repitch', stretchRatio: 2 }],
                },
            ],
        });
    });

    it('writes the exact replacement only when the expected state matches', () => {
        const result = handleRestoreClipStretchState.execute({
            type: 'restoreClipStretchState',
            payload: { clipId: 'clip-1', expected: presentState, replacement: absentState },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.restoreClipStretchState).toHaveBeenCalledWith({ clipId: 'clip-1', state: absentState });
    });

    it('conflicts when optional-field presence is stale', () => {
        const result = handleRestoreClipStretchState.execute({
            type: 'restoreClipStretchState',
            payload: {
                clipId: 'clip-1',
                expected: { ...presentState, ratio: { present: false, value: 2 } },
                replacement: absentState,
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.restoreClipStretchState).not.toHaveBeenCalled();
    });

    it('conflicts when only the start geometry changed', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    clips: [{ id: 'clip-1', startBeat: 1, endBeat: 8, stretchMode: 'repitch', stretchRatio: 2 }],
                },
            ],
        });

        const result = handleRestoreClipStretchState.execute({
            type: 'restoreClipStretchState',
            payload: { clipId: 'clip-1', expected: presentState, replacement: absentState },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.restoreClipStretchState).not.toHaveBeenCalled();
    });

    it('recognizes an exact absent optional-field replacement as a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'clip-1', startBeat: 0, endBeat: 4 }] }],
        });
        const action = {
            type: 'restoreClipStretchState' as const,
            payload: { clipId: 'clip-1', expected: presentState, replacement: absentState },
        };

        expect(handleRestoreClipStretchState.isNoop?.(action)).toBe(true);
        expect(handleRestoreClipStretchState.undoable).toBe(false);
        expect(handleRestoreClipStretchState.describe(action).inverseAction).toBeNull();
    });

    describe('replay guard', () => {
        it('is always batch-compensable, since expected is mandatory on this payload', () => {
            expect(
                handleRestoreClipStretchState.canReapplyAfterDivergence?.({
                    type: 'restoreClipStretchState',
                    payload: { clipId: 'clip-1', expected: presentState, replacement: absentState },
                })
            ).toBe(true);
        });

        it('validate rejects a diverged stretch state', () => {
            expect(
                handleRestoreClipStretchState.validate?.(
                    {
                        type: 'restoreClipStretchState',
                        payload: {
                            clipId: 'clip-1',
                            expected: { ...presentState, ratio: { present: false, value: 2 } },
                            replacement: absentState,
                        },
                    },
                    { actions: [], actionIndex: 0 }
                )
            ).toBe(false);
        });

        it('validate accepts a matching stretch state', () => {
            expect(
                handleRestoreClipStretchState.validate?.(
                    {
                        type: 'restoreClipStretchState',
                        payload: { clipId: 'clip-1', expected: presentState, replacement: absentState },
                    },
                    { actions: [], actionIndex: 0 }
                )
            ).toBe(true);
        });

        it('validate rejects when the clip no longer exists', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            expect(
                handleRestoreClipStretchState.validate?.(
                    {
                        type: 'restoreClipStretchState',
                        payload: { clipId: 'clip-1', expected: presentState, replacement: absentState },
                    },
                    { actions: [], actionIndex: 0 }
                )
            ).toBe(false);
        });
    });
});
