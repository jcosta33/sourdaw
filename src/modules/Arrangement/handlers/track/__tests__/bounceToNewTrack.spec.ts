import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBounceToNewTrack } from '../bounceToNewTrack';

const mocks = vi.hoisted(() => ({
    bounceToNewTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/freezeBounce/bounceOperations', () => ({
    bounceToNewTrack: mocks.bounceToNewTrack,
}));

describe('handleBounceToNewTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes bounceToNewTrack with the provided payload', async () => {
        await handleBounceToNewTrack.execute({
            type: 'bounceToNewTrack',
            payload: { trackId: 't1' },
        });

        expect(mocks.bounceToNewTrack).toHaveBeenCalledWith('t1');
    });

    it('provides a description', () => {
        const desc = handleBounceToNewTrack.describe({
            type: 'bounceToNewTrack',
            payload: { trackId: 't1' },
        });
        expect(desc.label).toBe('Bounce to new track');
    });

    it('is undoable', () => {
        expect(handleBounceToNewTrack.undoable).toBe(true);
    });
});
