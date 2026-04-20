import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDisableMpe } from '../handleDisableMpe';

const mocks = vi.hoisted(() => ({
    setMpeEnabled: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    setMpeEnabled: mocks.setMpeEnabled,
}));

describe('handleDisableMpe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setMpeEnabled(false)', () => {
        handleDisableMpe.execute({ type: 'disableMpe', payload: {} });

        expect(mocks.setMpeEnabled).toHaveBeenCalledWith(false);
    });

    it('provides a description', () => {
        const desc = handleDisableMpe.describe({ type: 'disableMpe', payload: {} });
        expect(desc.label).toBe('Disable MPE');
    });

    it('is not undoable', () => {
        expect(handleDisableMpe.undoable).toBe(false);
    });
});
