import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUnfreezeTrack } from '../unfreezeTrack';

const mocks = vi.hoisted(() => ({
    unfreezeTrack: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/unfreezeTrack', () => ({
    unfreezeTrack: mocks.unfreezeTrack,
}));

describe('handleUnfreezeTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes unfreezeTrack with the provided payload', () => {
        handleUnfreezeTrack.execute({
            type: 'unfreezeTrack',
            payload: { trackId: 't1' },
        });

        expect(mocks.unfreezeTrack).toHaveBeenCalledWith('t1');
    });

    it('provides a description', () => {
        const desc = handleUnfreezeTrack.describe({
            type: 'unfreezeTrack',
            payload: { trackId: 't1' },
        });
        expect(desc.label).toBe('Unfreeze track');
    });

    it('is undoable', () => {
        expect(handleUnfreezeTrack.undoable).toBe(true);
    });
});
