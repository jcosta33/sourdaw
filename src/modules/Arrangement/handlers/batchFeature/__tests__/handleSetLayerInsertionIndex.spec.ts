import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetLayerInsertionIndex } from '../handleSetLayerInsertionIndex';

const mocks = vi.hoisted(() => ({
    setLayerInsertionIndex: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/setLayerInsertionIndex', () => ({
    setLayerInsertionIndex: mocks.setLayerInsertionIndex,
}));

describe('handleSetLayerInsertionIndex', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards layer id and index', () => {
        handleSetLayerInsertionIndex.execute({
            type: 'setLayerInsertionIndex',
            payload: { layerId: 'L', insertionIndex: 3 },
        });
        expect(mocks.setLayerInsertionIndex).toHaveBeenCalledWith('L', 3);
    });
});
