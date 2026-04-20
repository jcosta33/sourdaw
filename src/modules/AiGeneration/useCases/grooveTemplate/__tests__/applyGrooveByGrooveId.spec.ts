import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyGrooveByGrooveId } from '../applyGrooveByGrooveId';

const mocks = vi.hoisted(() => ({
    getGrooveById: vi.fn(),
    applyGroove: vi.fn(),
}));

vi.mock('../../../repositories/factoryGrooves', () => ({
    getGrooveById: mocks.getGrooveById,
}));

vi.mock('../operations/applyGroove', () => ({
    applyGroove: mocks.applyGroove,
}));

describe('applyGrooveByGrooveId', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bails if the groove template cannot be found', () => {
        mocks.getGrooveById.mockReturnValue(undefined);

        applyGrooveByGrooveId('c1', 'g-missing', 0.5);

        expect(mocks.applyGroove).not.toHaveBeenCalled();
    });

    it('fetches the groove and applies it', () => {
        const mockTemplate = { id: 'g1', offsets: [], velocities: [], subdivisions: 16 };
        mocks.getGrooveById.mockReturnValue(mockTemplate);

        applyGrooveByGrooveId('c1', 'g1', 0.75);

        expect(mocks.getGrooveById).toHaveBeenCalledWith('g1');
        expect(mocks.applyGroove).toHaveBeenCalledWith('c1', mockTemplate, 0.75);
    });
});
