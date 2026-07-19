import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readUserPatchesText } from '../read-user-patches-text';

const STORAGE_KEY = 'fermenter-user-patches';

describe('readUserPatchesText', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('should read the raw text stored under the fermenter-user-patches storage key', () => {
        window.localStorage.setItem(STORAGE_KEY, '[{"id":"user-1","name":"Saved"}]');

        expect(readUserPatchesText()).toBe('[{"id":"user-1","name":"Saved"}]');
    });

    it('should return null when no value is stored under the key', () => {
        expect(readUserPatchesText()).toBeNull();
    });

    it('should not read a value stored under an unrelated storage key', () => {
        window.localStorage.setItem('some-other-key', '[{"id":"user-1"}]');

        expect(readUserPatchesText()).toBeNull();
    });

    it('should return null when window is unavailable', () => {
        vi.stubGlobal('window', undefined);

        expect(readUserPatchesText()).toBeNull();
    });

    it('should return null when reading storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage read blocked');
        });

        expect(readUserPatchesText()).toBeNull();
    });
});
