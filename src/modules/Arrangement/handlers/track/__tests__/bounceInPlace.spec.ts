import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleBounceInPlace } from '../bounceInPlace';

const mocks = vi.hoisted(() => ({
    bounceInPlace: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/freezeBounce/bounceInPlace', () => ({
    bounceInPlace: mocks.bounceInPlace,
}));

describe('handleBounceInPlace', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes bounceInPlace with the provided payload', () => {
        void handleBounceInPlace.execute({
            type: 'bounceInPlace',
            payload: { trackId: 't1' },
        });

        expect(mocks.bounceInPlace).toHaveBeenCalledWith('t1');
    });

    it('provides a description', () => {
        const desc = handleBounceInPlace.describe({
            type: 'bounceInPlace',
            payload: { trackId: 't1' },
        });
        expect(desc.label).toBe('Bounce in place');
    });

    it('is undoable', () => {
        expect(handleBounceInPlace.undoable).toBe(true);
    });
});
