import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRemoveFromVca } from '../handleRemoveFromVca';

const mocks = vi.hoisted(() => ({
    removeFromVca: vi.fn(),
}));

vi.mock('../../../useCases/vca/removeFromVca', () => ({
    removeFromVca: mocks.removeFromVca,
}));

describe('handleRemoveFromVca', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes removeFromVca with trackId', () => {
        handleRemoveFromVca.execute({
            type: 'removeFromVca',
            payload: { trackId: 't1' },
        });

        expect(mocks.removeFromVca).toHaveBeenCalledWith('t1');
    });

    it('is undoable', () => {
        expect(handleRemoveFromVca.undoable).toBe(true);
    });
});
