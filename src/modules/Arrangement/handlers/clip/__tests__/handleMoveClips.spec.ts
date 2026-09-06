import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleMoveClips } from '../handleMoveClips';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    moveClip: vi.fn(),
    planRippleMove: vi.fn(),
    rippleMoveClip: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('../../../useCases/clip/moveClip', () => ({ moveClip: mocks.moveClip }));
vi.mock('../../../useCases/rippleMove/planRippleMove', () => ({ planRippleMove: mocks.planRippleMove }));
vi.mock('../../../useCases/rippleMove/rippleMoveClip', () => ({ rippleMoveClip: mocks.rippleMoveClip }));

const baseTracks = [
    {
        id: 't1',
        clips: [
            { id: 'c1', startBeat: 0, endBeat: 4 },
            { id: 'c2', startBeat: 4, endBeat: 8 },
        ],
    },
    { id: 't2', clips: [] },
];

const moveAction = (moves: { clipId: string; trackId: string; startBeat: number }[], ripple = false) => ({
    type: 'moveClips' as const,
    payload: { moves, ripple },
});

describe('handleMoveClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: structuredClone(baseTracks) });
        mocks.moveClip.mockReturnValue(true);
        mocks.planRippleMove.mockReturnValue(null);
    });

    it('writes every requested move with the pre-gesture position as the automation anchor', () => {
        void handleMoveClips.execute(moveAction([{ clipId: 'c1', trackId: 't2', startBeat: 6 }]));

        expect(mocks.moveClip).toHaveBeenCalledWith('c1', 't2', 6, 0);
    });

    it('skips a clip with no pre-gesture placement and a release in place', () => {
        const result = handleMoveClips.execute(
            moveAction([
                { clipId: 'ghost', trackId: 't2', startBeat: 3 },
                { clipId: 'c2', trackId: 't1', startBeat: 4 },
            ])
        );

        expect(mocks.moveClip).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'no-write' });
    });

    it('ripple-moves a same-track target with its own plan and skips nothing else', () => {
        const plan = {
            gapClosedClips: [{ clipId: 'c2', origStartBeat: 4, origEndBeat: 8 }],
            destinationOpenedClips: [],
        };
        mocks.planRippleMove.mockReturnValue(plan);
        void handleMoveClips.execute(moveAction([{ clipId: 'c1', trackId: 't1', startBeat: 2 }], true));

        expect(mocks.planRippleMove).toHaveBeenCalledWith({
            trackId: 't1',
            clipId: 'c1',
            oldStartBeat: 0,
            newStartBeat: 2,
            clipDuration: 4,
        });
        expect(mocks.rippleMoveClip).toHaveBeenCalledWith({
            trackId: 't1',
            clipId: 'c1',
            newStartBeat: 2,
            clipDuration: 4,
            plan,
        });
        expect(mocks.moveClip).not.toHaveBeenCalled();
    });

    it('falls through to a plain move when the ripple plan is unavailable', () => {
        mocks.planRippleMove.mockReturnValue(null);
        void handleMoveClips.execute(moveAction([{ clipId: 'c1', trackId: 't1', startBeat: 2 }], true));

        expect(mocks.rippleMoveClip).not.toHaveBeenCalled();
        expect(mocks.moveClip).toHaveBeenCalledWith('c1', 't1', 2, 0);
    });

    it('finalizes the inverse to the exact pre-gesture placements and first-wins neighbor shifts', () => {
        const firstPlan = {
            gapClosedClips: [{ clipId: 'c2', origStartBeat: 4, origEndBeat: 8 }],
            destinationOpenedClips: [],
        };
        const secondPlan = {
            gapClosedClips: [],
            destinationOpenedClips: [{ clipId: 'c2', origStartBeat: 7, origEndBeat: 11 }],
        };
        mocks.planRippleMove.mockReturnValueOnce(firstPlan).mockReturnValueOnce(secondPlan);

        const action = moveAction(
            [
                { clipId: 'c1', trackId: 't1', startBeat: 2 },
                { clipId: 'c2', trackId: 't1', startBeat: 9 },
            ],
            true
        );
        const desc = handleMoveClips.describe(action);
        void handleMoveClips.execute(action);

        expect(desc.inverseAction).toEqual({
            type: 'restoreClipMoves',
            payload: {
                movedClips: [
                    { clipId: 'c1', trackId: 't1', startBeat: 0 },
                    { clipId: 'c2', trackId: 't1', startBeat: 4 },
                ],
                // The first plan's record of c2 wins: later plans see positions
                // an earlier ripple move already shifted.
                neighborShifts: [{ clipId: 'c2', origStartBeat: 4, origEndBeat: 8 }],
            },
        });
    });

    it('labels a mixed ripple gesture as a ripple move', () => {
        const action = moveAction(
            [
                { clipId: 'c1', trackId: 't1', startBeat: 2 },
                { clipId: 'c2', trackId: 't2', startBeat: 0 },
            ],
            true
        );
        expect(handleMoveClips.describe(action).label).toBe('Move clip (ripple)');
    });

    it('labels a plain multi-clip move with its count and a single move without one', () => {
        const pair = handleMoveClips.describe(
            moveAction([
                { clipId: 'c1', trackId: 't2', startBeat: 1 },
                { clipId: 'c2', trackId: 't2', startBeat: 5 },
            ])
        );
        const single = handleMoveClips.describe(moveAction([{ clipId: 'c1', trackId: 't2', startBeat: 1 }]));

        expect(pair.label).toBe('Move 2 clips');
        expect(single.label).toBe('Move clip');
    });

    it('is undoable', () => {
        expect(handleMoveClips.undoable).toBe(true);
    });
});
