import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetLayerMix } from '../handleSetLayerMix';

const mocks = vi.hoisted(() => ({
    setLayerMix: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/setLayerMix', () => ({
    setLayerMix: mocks.setLayerMix,
}));

describe('handleSetLayerMix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards layer id and mix value', () => {
        handleSetLayerMix.execute({ type: 'setLayerMix', payload: { layerId: 'L', mix: 0.5 } });
        expect(mocks.setLayerMix).toHaveBeenCalledWith('L', 0.5);
    });

    it('is undoable', () => {
        expect(handleSetLayerMix.undoable).toBe(true);
    });
});
