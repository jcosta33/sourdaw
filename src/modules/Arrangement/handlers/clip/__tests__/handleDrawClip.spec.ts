import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDrawClip } from '../handleDrawClip';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(),
    getNextAppActionClipId: vi.fn(() => 'clip-next'),
    planRippleInsert: vi.fn(),
    rippleInsertClip: vi.fn(),
}));

vi.mock('../../../useCases/clip/addClip', () => ({ addClip: mocks.addClip }));
vi.mock('../../../useCases/clip/getNextAppActionClipId', () => ({
    getNextAppActionClipId: mocks.getNextAppActionClipId,
}));
vi.mock('../../../useCases/rippleInsert/planRippleInsert', () => ({ planRippleInsert: mocks.planRippleInsert }));
vi.mock('../../../useCases/rippleInsert/rippleInsertClip', () => ({ rippleInsertClip: mocks.rippleInsertClip }));

const drawPayload = (overrides: Record<string, unknown> = {}) => ({
    type: 'drawClip' as const,
    payload: {
        trackId: 't1',
        startBeat: 2,
        endBeat: 5,
        name: 'Clip 2',
        type: 'audio' as const,
        ripple: false,
        ...overrides,
    },
});

describe('handleDrawClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.addClip.mockReturnValue({ id: 'clip-next' });
        mocks.planRippleInsert.mockReturnValue(null);
    });

    it('adds the clip with the pre-allocated id and no ripple plan when ripple is off', () => {
        const action = drawPayload();
        void handleDrawClip.execute(action);

        expect(mocks.planRippleInsert).not.toHaveBeenCalled();
        expect(mocks.addClip).toHaveBeenCalledWith({
            id: 'clip-next',
            trackId: 't1',
            startBeat: 2,
            endBeat: 5,
            name: 'Clip 2',
            type: 'audio',
        });
        expect(mocks.rippleInsertClip).not.toHaveBeenCalled();
    });

    it('computes the ripple plan before the add and inserts with it', () => {
        const plan = { shiftedClips: [{ clipId: 'c9', origStartBeat: 5, origEndBeat: 9 }] };
        mocks.planRippleInsert.mockReturnValue(plan);
        const action = drawPayload({ ripple: true });
        void handleDrawClip.execute(action);

        expect(mocks.planRippleInsert).toHaveBeenCalledWith({
            trackId: 't1',
            insertBeat: 2,
            insertDuration: 3,
        });
        expect(mocks.rippleInsertClip).toHaveBeenCalledWith({ trackId: 't1', insertDuration: 3, plan });
    });

    it('skips the ripple insert when the plan shifts nothing', () => {
        mocks.planRippleInsert.mockReturnValue({ shiftedClips: [] });
        const action = drawPayload({ ripple: true });
        void handleDrawClip.execute(action);

        expect(mocks.rippleInsertClip).not.toHaveBeenCalled();
    });

    it('reports no-write and never inserts when the add is refused', () => {
        mocks.planRippleInsert.mockReturnValue({ shiftedClips: [{ clipId: 'c9', origStartBeat: 5, origEndBeat: 9 }] });
        mocks.addClip.mockReturnValue(null);
        const action = drawPayload({ ripple: true });

        expect(handleDrawClip.execute(action)).toEqual({ status: 'no-write' });
        expect(mocks.rippleInsertClip).not.toHaveBeenCalled();
    });

    it('describes a plain draw with an id-pinned redo and a discard inverse', () => {
        const desc = handleDrawClip.describe(drawPayload());

        expect(desc.label).toBe('Draw clip');
        expect(desc.inverseAction).toEqual({
            type: 'discardDrawnClip',
            payload: { clipId: 'clip-next', trackId: 't1', ripplePlan: null },
        });
        expect(desc.redoAction).toEqual({ type: 'drawClip', payload: expect.objectContaining({ id: 'clip-next' }) });
    });

    it('describes a ripple draw whose inverse restores the exact shifted neighbors', () => {
        const plan = { shiftedClips: [{ clipId: 'c9', origStartBeat: 5, origEndBeat: 9 }] };
        mocks.planRippleInsert.mockReturnValue(plan);
        const action = drawPayload({ ripple: true });

        const desc = handleDrawClip.describe(action);

        expect(desc.label).toBe('Draw clip (ripple)');
        expect(desc.inverseAction).toEqual({
            type: 'discardDrawnClip',
            payload: {
                clipId: 'clip-next',
                trackId: 't1',
                ripplePlan: { shiftedClips: [{ clipId: 'c9', origStartBeat: 5, origEndBeat: 9 }] },
            },
        });
    });

    it('reuses one plan across describe and execute so undo restores what was written', () => {
        const plan = { shiftedClips: [{ clipId: 'c9', origStartBeat: 5, origEndBeat: 9 }] };
        mocks.planRippleInsert.mockReturnValue(plan);
        const action = drawPayload({ ripple: true });

        const desc = handleDrawClip.describe(action);
        void handleDrawClip.execute(action);

        expect(mocks.planRippleInsert).toHaveBeenCalledTimes(1);
        expect(desc.inverseAction).toEqual({
            type: 'discardDrawnClip',
            payload: {
                clipId: 'clip-next',
                trackId: 't1',
                ripplePlan: { shiftedClips: [{ clipId: 'c9', origStartBeat: 5, origEndBeat: 9 }] },
            },
        });
    });

    it('is undoable', () => {
        expect(handleDrawClip.undoable).toBe(true);
    });
});
