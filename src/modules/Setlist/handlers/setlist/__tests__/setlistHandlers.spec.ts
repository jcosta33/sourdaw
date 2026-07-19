import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleNextSetlistItem } from '../handleNextSetlistItem';
import { handlePreviousSetlistItem } from '../handlePreviousSetlistItem';

const mocks = vi.hoisted(() => ({
    nextItem: vi.fn(),
    previousItem: vi.fn(),
}));

vi.mock('../../../useCases/setlist/nextItem', () => ({ nextItem: mocks.nextItem }));
vi.mock('../../../useCases/setlist/previousItem', () => ({ previousItem: mocks.previousItem }));

describe('Setlist Handlers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('handleNextSetlistItem delegates to use case', () => {
        handleNextSetlistItem.execute({ type: 'nextSetlistItem', payload: undefined });
        expect(mocks.nextItem).toHaveBeenCalledTimes(1);
    });

    it('handlePreviousSetlistItem delegates to use case', () => {
        handlePreviousSetlistItem.execute({ type: 'previousSetlistItem', payload: undefined });
        expect(mocks.previousItem).toHaveBeenCalledTimes(1);
    });

    it('handleNextSetlistItem describes itself and is not undoable', () => {
        expect(handleNextSetlistItem.describe({ type: 'nextSetlistItem', payload: undefined })).toEqual({
            label: 'Next Setlist Item',
        });
        expect(handleNextSetlistItem.undoable).toBe(false);
    });

    it('handlePreviousSetlistItem describes itself and is not undoable', () => {
        expect(handlePreviousSetlistItem.describe({ type: 'previousSetlistItem', payload: undefined })).toEqual({
            label: 'Previous Setlist Item',
        });
        expect(handlePreviousSetlistItem.undoable).toBe(false);
    });
});
