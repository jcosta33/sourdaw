import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handlePreviousSetlistItem } from '../handlePreviousSetlistItem';

const mocks = vi.hoisted(() => ({
    previousItem: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    previousItem: mocks.previousItem,
}));

describe('handlePreviousSetlistItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes previousItem from Transport module', () => {
        handlePreviousSetlistItem.execute({ type: 'previousSetlistItem', payload: {} });
        expect(mocks.previousItem).toHaveBeenCalledTimes(1);
    });

    it('provides a description', () => {
        const desc = handlePreviousSetlistItem.describe({ type: 'previousSetlistItem', payload: {} });
        expect(desc.label).toBe('Previous Setlist Item');
    });

    it('is not undoable', () => {
        expect(handlePreviousSetlistItem.undoable).toBe(false);
    });
});
