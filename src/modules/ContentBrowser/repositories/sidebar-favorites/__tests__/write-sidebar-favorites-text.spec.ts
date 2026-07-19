import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeSidebarFavoritesText } from '../write-sidebar-favorites-text';

describe('writeSidebarFavoritesText', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('should write the given text under the sourdaw-favorites storage key', () => {
        writeSidebarFavoritesText('["favorite-a","favorite-b"]');

        expect(window.localStorage.getItem('sourdaw-favorites')).toBe('["favorite-a","favorite-b"]');
    });

    it('should overwrite a previously stored value under the same key', () => {
        window.localStorage.setItem('sourdaw-favorites', '["stale"]');

        writeSidebarFavoritesText('[]');

        expect(window.localStorage.getItem('sourdaw-favorites')).toBe('[]');
    });

    it('should not throw when window is unavailable', () => {
        vi.stubGlobal('window', undefined);

        expect(() => {
            writeSidebarFavoritesText('["favorite-a"]');
        }).not.toThrow();
    });

    it('should not throw when writing storage throws', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage write blocked');
        });

        expect(() => {
            writeSidebarFavoritesText('["favorite-a"]');
        }).not.toThrow();
    });
});
