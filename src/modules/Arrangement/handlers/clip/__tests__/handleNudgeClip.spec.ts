import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleNudgeClip } from '../handleNudgeClip';

const mocks = vi.hoisted(() => ({
    nudgeClip: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; clips: { id: string; startBeat: number }[] }[] } | null>(),
}));

vi.mock('../../../useCases/clipEditing/nudgeClip', () => ({
    nudgeClip: mocks.nudgeClip,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleNudgeClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes nudgeClip with the provided payload', () => {
        void handleNudgeClip.execute({
            type: 'nudgeClip',
            payload: { clipId: 'c1', beats: 1.5 },
        });

        expect(mocks.nudgeClip).toHaveBeenCalledWith('c1', 1.5);
    });

    it('provides a description reflecting direction', () => {
        const desc1 = handleNudgeClip.describe({
            type: 'nudgeClip',
            payload: { clipId: 'c1', beats: 0.5 },
        });
        expect(desc1.label).toBe('Nudge clip right');

        const desc2 = handleNudgeClip.describe({
            type: 'nudgeClip',
            payload: { clipId: 'c1', beats: -0.5 },
        });
        expect(desc2.label).toBe('Nudge clip left');
    });

    it('describes an inverse nudge of the negated applied delta', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 2 }] }],
        });

        const desc = handleNudgeClip.describe({
            type: 'nudgeClip',
            payload: { clipId: 'c1', beats: 1.5 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'nudgeClip',
            payload: { clipId: 'c1', beats: -1.5 },
        });
    });

    it('describes an inverse of the post-clamp delta when the forward nudge clamps at beat 0', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0.5 }] }],
        });

        const desc = handleNudgeClip.describe({
            type: 'nudgeClip',
            payload: { clipId: 'c1', beats: -1 },
        });

        // Forward nudge applies only -0.5 (clamped at 0); the inverse must be
        // +0.5, not +1, or undo/redo drift the clip's notes off its rectangle.
        expect(desc.inverseAction).toEqual({
            type: 'nudgeClip',
            payload: { clipId: 'c1', beats: 0.5 },
        });
    });

    it('describes a null inverse when the clip is not found', () => {
        const desc = handleNudgeClip.describe({
            type: 'nudgeClip',
            payload: { clipId: 'missing', beats: 1 },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('is undoable', () => {
        expect(handleNudgeClip.undoable).toBe(true);
    });
});
