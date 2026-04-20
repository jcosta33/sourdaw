import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleNextSetlistItem } from '../handleNextSetlistItem';

const mocks = vi.hoisted(() => ({
    nextItem: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    nextItem: mocks.nextItem,
}));

describe('handleNextSetlistItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes nextItem from Transport module', () => {
        handleNextSetlistItem.execute({ type: 'nextSetlistItem', payload: {} });
        expect(mocks.nextItem).toHaveBeenCalledTimes(1);
    });

    it('provides a description', () => {
        const desc = handleNextSetlistItem.describe({ type: 'nextSetlistItem', payload: {} });
        expect(desc.label).toBe('Next Setlist Item');
    });

    it('is not undoable', () => {
        expect(handleNextSetlistItem.undoable).toBe(false);
    });
});
