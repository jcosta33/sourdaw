import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleClearSolos } from '../clearSolos';

const mocks = vi.hoisted(() => ({
    clearSolos: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/clearSolos', () => ({
    clearSolos: mocks.clearSolos,
}));

describe('handleClearSolos', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes clearSolos', () => {
        handleClearSolos.execute({
            type: 'clearSolos',
            payload: {},
        });

        expect(mocks.clearSolos).toHaveBeenCalledTimes(1);
    });

    it('provides a description', () => {
        const desc = handleClearSolos.describe({
            type: 'clearSolos',
            payload: {},
        });
        expect(desc.label).toBe('Clear all solos');
    });

    it('is undoable', () => {
        expect(handleClearSolos.undoable).toBe(true);
    });
});
