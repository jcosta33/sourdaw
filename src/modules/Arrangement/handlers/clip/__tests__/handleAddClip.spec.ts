import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddClip } from '../handleAddClip';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(),
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: mocks.addClip,
}));

describe('handleAddClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes addClip with the payload', () => {
        mocks.addClip.mockReturnValue({ id: 'clip-1' });
        const payload = {
            trackId: 't1',
            name: 'New Clip',
            startBeat: 0,
            endBeat: 4,
            type: 'audio' as const,
        };

        const result = handleAddClip.execute({ type: 'addClip', payload });

        expect(mocks.addClip).toHaveBeenCalledWith(payload);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when addClip rejects the target track', () => {
        mocks.addClip.mockReturnValue(null);
        const result = handleAddClip.execute({
            type: 'addClip',
            payload: { trackId: 'vca-1', name: 'Rejected', startBeat: 0, endBeat: 4, type: 'audio' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description based on clip name', () => {
        const desc = handleAddClip.describe({
            type: 'addClip',
            payload: {
                trackId: 't1',
                name: 'New Clip',
                startBeat: 0,
                endBeat: 4,
                type: 'audio' as const,
            },
        });
        expect(desc.label).toBe('Add clip "New Clip"');
    });

    it('is undoable', () => {
        expect(handleAddClip.undoable).toBe(true);
    });
});
