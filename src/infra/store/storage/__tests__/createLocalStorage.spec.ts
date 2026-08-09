import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { createLocalStorage } from '../createLocalStorage';

describe('createLocalStorage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return null when localStorage is empty', () => {
        const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
        expect(storage.get()).toBeNull();
    });

    it('should store and retrieve a value', () => {
        const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
        storage.set({ count: 42 });
        expect(storage.get()).toEqual({ count: 42 });
    });

    it('should persist to localStorage', () => {
        const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
        storage.set({ count: 42 });

        // Create a new storage instance pointing to the same key
        const storage2 = createLocalStorage<{ count: number }>('sourdaw-preferences');
        expect(storage2.get()).toEqual({ count: 42 });
    });

    it('should clear the value and remove from localStorage', () => {
        const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
        storage.set({ count: 42 });
        storage.clear();

        expect(storage.get()).toBeNull();
        expect(localStorage.getItem('sourdaw-preferences')).toBeNull();
    });

    it('should clear when setting null', () => {
        const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
        storage.set({ count: 42 });
        storage.set(null);

        expect(storage.get()).toBeNull();
        expect(localStorage.getItem('sourdaw-preferences')).toBeNull();
    });

    it('keeps the cached value when setItem fails and retries persistence', () => {
        const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
        storage.set({ count: 42 });

        const persistenceFailure = new Error('setItem blocked');
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw persistenceFailure;
        });

        expect(() => storage.set({ count: 84 })).toThrow(persistenceFailure);
        expect(storage.get()).toEqual({ count: 42 });

        storage.set({ count: 84 });

        expect(setItem).toHaveBeenCalledTimes(2);
        expect(storage.get()).toEqual({ count: 84 });
    });

    it('keeps the cached value when setting null cannot remove the durable value', () => {
        const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
        storage.set({ count: 42 });

        const persistenceFailure = new Error('removeItem blocked');
        const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
            throw persistenceFailure;
        });

        expect(() => storage.set(null)).toThrow(persistenceFailure);
        expect(storage.get()).toEqual({ count: 42 });

        storage.set(null);

        expect(removeItem).toHaveBeenCalledTimes(2);
        expect(storage.get()).toBeNull();
    });

    it('keeps the cached value when clear cannot remove the durable value', () => {
        const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
        storage.set({ count: 42 });

        const persistenceFailure = new Error('removeItem blocked');
        const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
            throw persistenceFailure;
        });

        expect(() => storage.clear()).toThrow(persistenceFailure);
        expect(storage.get()).toEqual({ count: 42 });

        storage.clear();

        expect(removeItem).toHaveBeenCalledTimes(2);
        expect(storage.get()).toBeNull();
    });

    describe('trySet', () => {
        it('reports true and persists when the backing store accepts the write', () => {
            const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');

            expect(storage.trySet({ count: 42 })).toBe(true);
            expect(localStorage.getItem('sourdaw-preferences')).not.toBeNull();
            expect(createLocalStorage<{ count: number }>('sourdaw-preferences').get()).toEqual({ count: 42 });
        });

        it('reports false without throwing when the origin quota refuses the write', () => {
            const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
            storage.set({ count: 42 });

            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
            });

            expect(storage.trySet({ count: 84 })).toBe(false);
        });

        it('advances the visible value on a dropped write, unlike set', () => {
            // The inverse of `set`'s pinned cache contract, and deliberately so:
            // `trySet` exists for callers that will not retry, and leaving them
            // reading a value they have already moved past is the second defect
            // after the dropped write. The boolean is how they learn it is not
            // durable.
            const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
            storage.set({ count: 42 });

            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
            });

            storage.trySet({ count: 84 });

            expect(storage.get()).toEqual({ count: 84 });
            expect(localStorage.getItem('sourdaw-preferences')).toBe(stringify({ count: 42 }));
        });

        it('names the refused key and its payload size so a full origin can be attributed', () => {
            const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
            const storage = createLocalStorage<{ count: number }>('sourdaw-shortcuts');

            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
            });

            storage.trySet({ count: 84 });

            const message = warn.mock.calls[0]?.[0];
            expect(typeof message === 'string' ? message : '').toContain('sourdaw-shortcuts');
            expect(typeof message === 'string' ? message : '').toContain(`${stringify({ count: 84 }).length} chars`);
        });
    });

    it('should cache the value to avoid repeated localStorage reads', () => {
        const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
        storage.set({ count: 42 });

        const spy = vi.spyOn(Storage.prototype, 'getItem');
        storage.get();
        storage.get();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('should report as supported when localStorage is available', () => {
        const storage = createLocalStorage<{ count: number }>('sourdaw-preferences');
        expect(storage.isSupported()).toBe(true);
    });
});
