import { afterEach, describe, expect, it, vi } from 'vitest';

import { readLegacyChordTrackStorage } from '../readLegacyChordTrackStorage';

describe('readLegacyChordTrackStorage', () => {
    const KEY = 'sourdaw_chord_track';

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns null when localStorage has no entry for the key', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);

        const result = readLegacyChordTrackStorage();

        expect(result).toBeNull();
    });

    it('returns the raw string when an entry exists', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('{"chords":[]}');

        const result = readLegacyChordTrackStorage();

        expect(result).not.toBeNull();
        expect(result?.raw).toBe('{"chords":[]}');
    });

    it('returns null when localStorage.getItem throws (privacy mode / blocked access)', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });

        const result = readLegacyChordTrackStorage();

        expect(result).toBeNull();
    });

    it('remove deletes the entry when the stored value matches the original raw', () => {
        const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
        vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('legacy-data');

        const result = readLegacyChordTrackStorage();
        result?.remove();

        expect(removeItemSpy).toHaveBeenCalledWith(KEY);
    });

    it('remove does NOT delete the entry when the stored value changed since read', () => {
        // The remove closure captures the raw at read time. If another process
        // overwrote localStorage in between, remove must not clobber it.
        let currentValue = 'original';
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => currentValue);
        const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});

        const result = readLegacyChordTrackStorage();
        // Simulate another writer changing the value.
        currentValue = 'overwritten-by-someone-else';
        result?.remove();

        // removeItem must NOT have been called — the value changed.
        expect(removeItemSpy).not.toHaveBeenCalled();
    });

    it('remove swallows a localStorage error without throwing', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('data');
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('blocked');
        });

        const result = readLegacyChordTrackStorage();

        // A blocked cleanup must not invalidate an already committed migration.
        expect(() => result?.remove()).not.toThrow();
    });
});
