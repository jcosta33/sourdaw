import { describe, it, expect } from 'vitest';

import { createMemoryStorage } from '../createMemoryStorage';

describe('createMemoryStorage', () => {
    it('should return null initially', () => {
        const storage = createMemoryStorage<{ count: number }>();
        expect(storage.get()).toBeNull();
    });

    it('should store and retrieve a value', () => {
        const storage = createMemoryStorage<{ count: number }>();
        storage.set({ count: 42 });
        expect(storage.get()).toEqual({ count: 42 });
    });

    it('should support setting null', () => {
        const storage = createMemoryStorage<{ count: number }>();
        storage.set({ count: 1 });
        storage.set(null);
        expect(storage.get()).toBeNull();
    });

    it('should clear the value', () => {
        const storage = createMemoryStorage<{ count: number }>();
        storage.set({ count: 1 });
        storage.clear();
        expect(storage.get()).toBeNull();
    });

    it('should always report as supported', () => {
        const storage = createMemoryStorage();
        expect(storage.isSupported()).toBe(true);
    });

    it('should preserve reference identity', () => {
        const storage = createMemoryStorage<{ count: number }>();
        const obj = { count: 1 };
        storage.set(obj);
        expect(storage.get()).toBe(obj);
    });
});
