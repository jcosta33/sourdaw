import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeUserPatchesText } from '../write-user-patches-text';

const STORAGE_KEY = 'fermenter-user-patches';

describe('writeUserPatchesText', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('should write the given text under the fermenter-user-patches storage key and return true', () => {
        expect(writeUserPatchesText('[{"id":"user-1","name":"Saved"}]')).toBe(true);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('[{"id":"user-1","name":"Saved"}]');
    });

    it('should overwrite a previously stored value under the same key', () => {
        window.localStorage.setItem(STORAGE_KEY, '[{"id":"stale"}]');

        expect(writeUserPatchesText('[]')).toBe(true);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('[]');
    });

    it('should return false and not throw when window is unavailable', () => {
        vi.stubGlobal('window', undefined);

        expect(() => {
            expect(writeUserPatchesText('[{"id":"user-1"}]')).toBe(false);
        }).not.toThrow();
    });

    it('should return false and not throw when writing storage throws', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage write blocked');
        });

        expect(() => {
            expect(writeUserPatchesText('[{"id":"user-1"}]')).toBe(false);
        }).not.toThrow();
    });
});
