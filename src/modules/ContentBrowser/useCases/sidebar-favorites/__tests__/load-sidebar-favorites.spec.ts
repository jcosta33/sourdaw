import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadSidebarFavorites } from '../load-sidebar-favorites';

describe('loadSidebarFavorites', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        window.localStorage.clear();
        vi.clearAllMocks();
    });

    it('should load only string favorite entries from a stored array', () => {
        window.localStorage.setItem(
            'sourdaw-favorites',
            JSON.stringify(['favorite-a', 42, 'favorite-b', null, { id: 'favorite-c' }, false])
        );

        expect(Array.from(loadSidebarFavorites())).toEqual(['favorite-a', 'favorite-b']);
    });

    it('should hydrate invalid JSON to an empty favorites set', () => {
        window.localStorage.setItem('sourdaw-favorites', '{invalid');

        expect(Array.from(loadSidebarFavorites())).toEqual([]);
    });

    it('should hydrate invalid top-level values to an empty favorites set', () => {
        const invalidStoredValues = ['"favorite-a"', '{"0":"favorite-a"}', '7', 'false', 'null'];

        for (const storedValue of invalidStoredValues) {
            window.localStorage.setItem('sourdaw-favorites', storedValue);

            expect(Array.from(loadSidebarFavorites())).toEqual([]);
        }
    });

    it('should hydrate missing browser storage to an empty favorites set', () => {
        vi.stubGlobal('window', undefined);

        expect(Array.from(loadSidebarFavorites())).toEqual([]);
    });
});
