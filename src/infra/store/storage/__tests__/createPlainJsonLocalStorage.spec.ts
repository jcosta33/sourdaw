import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlainJsonLocalStorage } from '../createPlainJsonLocalStorage';

type Decoded = { count: number };

const decode = (value: unknown): Decoded | null => {
    if (value !== null && typeof value === 'object' && 'count' in value && typeof value.count === 'number') {
        return { count: value.count };
    }
    return null;
};

describe('createPlainJsonLocalStorage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns null when localStorage is empty', () => {
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });
        expect(storage.get()).toBeNull();
    });

    it('stores and retrieves a value round-tripped through JSON', () => {
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });
        storage.set({ count: 42 });
        expect(storage.get()).toEqual({ count: 42 });
        expect(localStorage.getItem('navigationBrandsSearch')).toBe('{"count":42}');
    });

    it('reads a raw value already present in localStorage through the decoder', () => {
        localStorage.setItem('navigationBrandsSearch', JSON.stringify({ count: 7 }));
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });
        expect(storage.get()).toEqual({ count: 7 });
    });

    it('caches the decoded value and does not re-read localStorage on subsequent gets', () => {
        localStorage.setItem('navigationBrandsSearch', JSON.stringify({ count: 7 }));
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });

        storage.get();
        const spy = vi.spyOn(Storage.prototype, 'getItem');
        storage.get();
        expect(spy).not.toHaveBeenCalled();
    });

    it('returns null and caches null when the decoder rejects the parsed shape', () => {
        localStorage.setItem('navigationBrandsSearch', JSON.stringify({ wrong: 'shape' }));
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });
        expect(storage.get()).toBeNull();
    });

    it('returns null when the stored value is not valid JSON', () => {
        localStorage.setItem('navigationBrandsSearch', 'not-json{');
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });
        expect(storage.get()).toBeNull();
    });

    it('returns null when reading localStorage throws', () => {
        const readFailure = new Error('getItem blocked');
        vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
            throw readFailure;
        });
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });
        expect(storage.get()).toBeNull();
    });

    it('clears the value and removes it from localStorage when set to null', () => {
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });
        storage.set({ count: 42 });
        storage.set(null);

        expect(storage.get()).toBeNull();
        expect(localStorage.getItem('navigationBrandsSearch')).toBeNull();
    });

    it('clears the value and removes it from localStorage via clear()', () => {
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });
        storage.set({ count: 42 });
        storage.clear();

        expect(storage.get()).toBeNull();
        expect(localStorage.getItem('navigationBrandsSearch')).toBeNull();
    });

    it('reports as supported when localStorage is available', () => {
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });
        expect(storage.isSupported()).toBe(true);
    });

    it('reports as unsupported when accessing localStorage throws', () => {
        const storage = createPlainJsonLocalStorage<Decoded>({ key: 'navigationBrandsSearch', decode });
        const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() {
                throw new Error('localStorage disabled');
            },
        });

        expect(storage.isSupported()).toBe(false);

        if (descriptor) {
            Object.defineProperty(window, 'localStorage', descriptor);
        }
    });
});
