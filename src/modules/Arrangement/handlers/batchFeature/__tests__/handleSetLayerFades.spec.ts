import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetLayerFades } from '../handleSetLayerFades';

const mocks = vi.hoisted(() => ({
    setLayerFades: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/setLayerFades', () => ({
    setLayerFades: mocks.setLayerFades,
}));

describe('handleSetLayerFades', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards region id and fade values', () => {
        handleSetLayerFades.execute({
            type: 'setLayerFades',
            payload: { regionId: 'R', fadeInBeats: 0.5, fadeOutBeats: 1 },
        });
        expect(mocks.setLayerFades).toHaveBeenCalledWith('R', 0.5, 1);
    });
});
