import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleNudgeClip } from '../handleNudgeClip';

const mocks = vi.hoisted(() => ({
    nudgeClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/nudgeClip', () => ({
    nudgeClip: mocks.nudgeClip,
}));

describe('handleNudgeClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

    it('describes an inverse nudge of the negated beat delta', () => {
        const desc = handleNudgeClip.describe({
            type: 'nudgeClip',
            payload: { clipId: 'c1', beats: 1.5 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'nudgeClip',
            payload: { clipId: 'c1', beats: -1.5 },
        });
    });

    it('is undoable', () => {
        expect(handleNudgeClip.undoable).toBe(true);
    });
});
