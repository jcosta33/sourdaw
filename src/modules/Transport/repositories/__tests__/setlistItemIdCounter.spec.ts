import { describe, it, expect } from 'vitest';

import { getNextSetlistItemId, SETLIST_ITEM_COLORS } from '../setlistItemIdCounter';

describe('setlistItemIdCounter', () => {
    describe('getNextSetlistItemId', () => {
        it('should return a unique setlist item ID', () => {
            const id1 = getNextSetlistItemId();
            const id2 = getNextSetlistItemId();
            expect(id1.startsWith('sli-')).toBe(true);
            expect(id2.startsWith('sli-')).toBe(true);
            expect(id1).not.toBe(id2);
        });
    });

    describe('SETLIST_ITEM_COLORS', () => {
        it('should be an array of color strings', () => {
            expect(Array.isArray(SETLIST_ITEM_COLORS)).toBe(true);
            expect(SETLIST_ITEM_COLORS.length).toBeGreaterThan(0);
            expect(typeof SETLIST_ITEM_COLORS[0]).toBe('string');
        });
    });
});
