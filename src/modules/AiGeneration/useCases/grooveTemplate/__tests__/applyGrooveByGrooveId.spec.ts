import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyGrooveByGrooveId } from '../applyGrooveByGrooveId';
import { registerExtractedGroove } from '../registerExtractedGroove';

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

    it('applies a previously registered extracted groove the factory roster does not know', () => {
        // Factory roster has no such id — pre-fix this made extract a no-op.
        mocks.getGrooveById.mockReturnValue(undefined);

        const extracted = {
            id: 'extracted-clip-7',
            name: 'Extracted from clip-7',
            subdivisions: 16,
            offsets: [0.1],
            velocities: [1.05],
        };
        registerExtractedGroove(extracted);

        applyGrooveByGrooveId('clip-7', 'extracted-clip-7', 0.5);

        expect(mocks.applyGroove).toHaveBeenCalledWith('clip-7', extracted, 0.5);
        // The registry, not the factory roster, supplied the template.
        expect(mocks.getGrooveById).not.toHaveBeenCalled();
    });

    it('falls back to the factory roster for ids not in the extracted registry', () => {
        const factory = { id: 'swing-light', name: 'Light Swing', offsets: [], velocities: [], subdivisions: 16 };
        mocks.getGrooveById.mockReturnValue(factory);

        applyGrooveByGrooveId('c2', 'swing-light', 1);

        expect(mocks.getGrooveById).toHaveBeenCalledWith('swing-light');
        expect(mocks.applyGroove).toHaveBeenCalledWith('c2', factory, 1);
    });
});
