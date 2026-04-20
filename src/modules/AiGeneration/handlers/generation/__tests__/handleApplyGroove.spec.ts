import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleApplyGroove } from '../handleApplyGroove';

const { applyGrooveByGrooveId } = vi.hoisted(() => ({
    applyGrooveByGrooveId: vi.fn(),
}));

vi.mock('../../../useCases/grooveTemplate/applyGrooveByGrooveId', () => ({
    applyGrooveByGrooveId,
}));

describe('handleApplyGroove', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes applyGrooveByGrooveId with the correct payload', () => {
        void handleApplyGroove.execute({
            type: 'applyGroove',
            payload: { clipId: 'c1', grooveId: 'g1', amount: 0.5 },
        });

        expect(applyGrooveByGrooveId).toHaveBeenCalledWith('c1', 'g1', 0.5);
    });

    it('defaults amount to 1 if not provided', () => {
        void handleApplyGroove.execute({
            type: 'applyGroove',
            payload: { clipId: 'c1', grooveId: 'g1' },
        });

        expect(applyGrooveByGrooveId).toHaveBeenCalledWith('c1', 'g1', 1);
    });

    it('provides a description', () => {
        const desc = handleApplyGroove.describe({
            type: 'applyGroove',
            payload: { clipId: 'c1', grooveId: 'g1' },
        });
        expect(desc.label).toBe('Apply groove "g1"');
    });

    it('is marked as undoable', () => {
        expect(handleApplyGroove.undoable).toBe(true);
    });
});
