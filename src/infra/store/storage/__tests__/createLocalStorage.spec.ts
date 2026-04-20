import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createLocalStorage } from '../createLocalStorage';

describe('createLocalStorage', () => {
    beforeEach(() => {
        localStorage.clear();
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
