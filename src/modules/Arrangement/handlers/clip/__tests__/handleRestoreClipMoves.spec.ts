import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRestoreClipMoves } from '../handleRestoreClipMoves';

const mocks = vi.hoisted(() => ({
    moveClip: vi.fn(),
    getTrackStoreState: vi.fn(),
    setTrackState: vi.fn(),
}));

vi.mock('../../../useCases/clip/moveClip', () => ({ moveClip: mocks.moveClip }));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('../../../useCases/setTrackState', () => ({ setTrackState: mocks.setTrackState }));

const restoreAction = (
    movedClips: { clipId: string; trackId: string; startBeat: number }[],
    neighborShifts: { clipId: string; origStartBeat: number; origEndBeat: number }[]
) => ({ type: 'restoreClipMoves' as const, payload: { movedClips, neighborShifts } });

describe('handleRestoreClipMoves', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('restores every moved clip to its pre-gesture placement', () => {
        void handleRestoreClipMoves.execute(
            restoreAction(
                [
                    { clipId: 'c1', trackId: 't1', startBeat: 0 },
                    { clipId: 'c2', trackId: 't2', startBeat: 3 },
                ],
                []
            )
        );

        expect(mocks.moveClip).toHaveBeenCalledWith('c1', 't1', 0);
        expect(mocks.moveClip).toHaveBeenCalledWith('c2', 't2', 3);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('restores ripple-shifted neighbors to their recorded positions across all tracks', () => {
        const state = {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 2, endBeat: 6 },
                        { id: 'c9', startBeat: 7, endBeat: 11 },
                    ],
                },
                { id: 't2', clips: [{ id: 'c8', startBeat: 1, endBeat: 3 }] },
            ],
        };
        mocks.getTrackStoreState.mockReturnValue(state);
        void handleRestoreClipMoves.execute(
            restoreAction(
                [{ clipId: 'c1', trackId: 't1', startBeat: 0 }],
                [
                    { clipId: 'c9', origStartBeat: 4, origEndBeat: 8 },
                    { clipId: 'c8', origStartBeat: 0, origEndBeat: 2 },
                ]
            )
        );

        expect(mocks.setTrackState).toHaveBeenCalledWith({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 2, endBeat: 6 },
                        { id: 'c9', startBeat: 4, endBeat: 8 },
                    ],
                },
                { id: 't2', clips: [{ id: 'c8', startBeat: 0, endBeat: 2 }] },
            ],
        });
    });

    it('restores positions from the live store, not the recorded state', () => {
        // The moved clips are already back (moveClip above), so the neighbor
        // restore must read the CURRENT store — a stale snapshot would clobber
        // the moves just performed.
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c9', startBeat: 7, endBeat: 11 }] }],
        });
        void handleRestoreClipMoves.execute(restoreAction([], [{ clipId: 'c9', origStartBeat: 4, origEndBeat: 8 }]));

        expect(mocks.setTrackState).toHaveBeenCalledWith({
            tracks: [{ id: 't1', clips: [{ id: 'c9', startBeat: 4, endBeat: 8 }] }],
        });
    });

    it('describes without an inverse and is not undoable', () => {
        const desc = handleRestoreClipMoves.describe(restoreAction([], []));

        expect(desc.label).toBe('Restore clip moves');
        expect(desc.inverseAction).toBeUndefined();
        expect(handleRestoreClipMoves.undoable).toBe(false);
    });
});
