import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetLayerParameter } from '../handleSetLayerParameter';

const mocks = vi.hoisted(() => ({
    setLayerParameter: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/setLayerParameter', () => ({
    setLayerParameter: mocks.setLayerParameter,
}));

describe('handleSetLayerParameter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards the full payload', () => {
        handleSetLayerParameter.execute({
            type: 'setLayerParameter',
            payload: { layerId: 'L', paramName: 'Gain', value: 3 },
        });
        expect(mocks.setLayerParameter).toHaveBeenCalledWith('L', 'Gain', 3);
    });

    it('is undoable', () => {
        expect(handleSetLayerParameter.undoable).toBe(true);
    });
});
