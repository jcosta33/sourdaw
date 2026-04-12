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
        const payload = {
            trackId: 't1',
            name: 'New Clip',
            startBeat: 0,
            endBeat: 4,
            type: 'audio' as const,
        };

        handleAddClip.execute({ type: 'addClip', payload });

        expect(mocks.addClip).toHaveBeenCalledWith(payload);
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
