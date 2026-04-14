import { describe, it, expect } from 'vitest';
import { getNextSetlistItemId, SETLIST_ITEM_COLORS } from '../setlistItemIdCounter';

describe('setlistItemIdCounter', () => {
    describe('getNextSetlistItemId', () => {
        it('should return a setlist item ID and increment it', () => {
            const id1 = getNextSetlistItemId();
            const id2 = getNextSetlistItemId();
            expect(id1.startsWith('sli-')).toBe(true);
            expect(id1).not.toBe(id2);
            
            const n1 = parseInt(id1.split('-')[1]!);
            const n2 = parseInt(id2.split('-')[1]!);
            expect(n2).toBe(n1 + 1);
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
