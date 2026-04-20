import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleEnableMpe } from '../handleEnableMpe';

const mocks = vi.hoisted(() => ({
    setMpeEnabled: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    setMpeEnabled: mocks.setMpeEnabled,
}));

describe('handleEnableMpe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setMpeEnabled(true)', () => {
        handleEnableMpe.execute({ type: 'enableMpe', payload: {} });

        expect(mocks.setMpeEnabled).toHaveBeenCalledWith(true);
    });

    it('provides a description', () => {
        const desc = handleEnableMpe.describe({ type: 'enableMpe', payload: {} });
        expect(desc.label).toBe('Enable MPE');
    });

    it('is not undoable', () => {
        expect(handleEnableMpe.undoable).toBe(false);
    });
});
