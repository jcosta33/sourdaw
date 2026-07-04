import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveSidebarFavorites } from '../save-sidebar-favorites';

describe('saveSidebarFavorites', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        window.localStorage.clear();
        vi.clearAllMocks();
    });

    it('should save favorites with the existing storage key and JSON array shape', () => {
        saveSidebarFavorites(new Set(['favorite-a', 'favorite-b']));

        expect(window.localStorage.getItem('sourdaw-favorites')).toBe('["favorite-a","favorite-b"]');
    });

    it('should not throw when browser storage is missing', () => {
        vi.stubGlobal('window', undefined);

        expect(() => {
            saveSidebarFavorites(new Set(['favorite-a']));
        }).not.toThrow();
    });
});
