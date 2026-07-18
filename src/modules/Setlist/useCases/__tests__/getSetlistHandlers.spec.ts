import { describe, it, expect } from 'vitest';

import { getSetlistHandlers } from '../getSetlistHandlers';

describe('getSetlistHandlers', () => {
    it('returns a fresh map containing every setlist command handler', () => {
        const map = getSetlistHandlers();
        for (const key of ['nextSetlistItem', 'previousSetlistItem'] as const) {
            expect(map[key]).toBeDefined();
            expect(map[key].execute).toBeDefined();
        }
        expect(getSetlistHandlers()).not.toBe(map);
    });
});
