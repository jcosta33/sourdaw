import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readSidebarFavoritesText } from '../read-sidebar-favorites-text';

describe('readSidebarFavoritesText', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('should read the raw text stored under the sourdaw-favorites storage key', () => {
        window.localStorage.setItem('sourdaw-favorites', '["favorite-a","favorite-b"]');

        expect(readSidebarFavoritesText()).toBe('["favorite-a","favorite-b"]');
    });

    it('should return null when no value is stored under the key', () => {
        expect(readSidebarFavoritesText()).toBeNull();
    });

    it('should return null when window is unavailable', () => {
        vi.stubGlobal('window', undefined);

        expect(readSidebarFavoritesText()).toBeNull();
    });

    it('should return null when reading storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage read blocked');
        });

        expect(readSidebarFavoritesText()).toBeNull();
    });
});
