import { describe, it, expect, vi } from 'vitest';

import { type Logger } from '#/infra/logger/types';

import { createStore } from '../createStore';
import { createMemoryStorage } from '../storage/createMemoryStorage';

const createDummyLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setWriters: vi.fn(),
});

describe('createStore', () => {
    it('should return null when created with no initial data', () => {
        const store = createStore<{ count: number }>();
        expect(store.value).toBeNull();
    });

    it('should return initialData from value when storage is empty', () => {
        const store = createStore({ initialData: { count: 0 } });
        expect(store.value).toEqual({ count: 0 });
    });

    it('should update value on set', () => {
        const store = createStore({ initialData: { count: 0 } });
        store.set({ count: 1 });
        expect(store.value).toEqual({ count: 1 });
    });

    it('should support setting value to null', () => {
        const store = createStore({ initialData: { count: 0 } });
        store.set(null);
        expect(store.value).toBeNull();
    });

    it('should notify subscribers on set', () => {
        const store = createStore({ initialData: { count: 0 } });
        const subscriber = vi.fn();
        store.subscribe(subscriber);

        store.set({ count: 1 });

        expect(subscriber).toHaveBeenCalledWith({ count: 1 });
    });

    it('should notify subscribers with null on set(null)', () => {
        const store = createStore({ initialData: { count: 0 } });
        const subscriber = vi.fn();
        store.subscribe(subscriber);

        store.set(null);

        expect(subscriber).toHaveBeenCalledWith(null);
    });

    it('should return an unsubscribe function from subscribe', () => {
        const store = createStore({ initialData: { count: 0 } });
        const subscriber = vi.fn();
        const unsubscribe = store.subscribe(subscriber);

        unsubscribe();
        store.set({ count: 1 });

        expect(subscriber).not.toHaveBeenCalled();
    });

    it('should support atomic read-modify-write via update', () => {
        const store = createStore({ initialData: { count: 0 } });
        store.update((current) => (current ? { count: current.count + 1 } : null));
        expect(store.value).toEqual({ count: 1 });
    });

    it('should clear the store and notify subscribers', () => {
        const store = createStore({ initialData: { count: 42 } });
        const subscriber = vi.fn();
        store.subscribe(subscriber);

        store.clear();

        expect(store.value).toBeNull();
        expect(subscriber).toHaveBeenCalledWith(null);
    });

    it('should use a custom storage adapter', () => {
        const storage = createMemoryStorage<{ name: string }>();
        storage.set({ name: 'existing' });

        const store = createStore({ storage, initialData: { name: 'default' } });

        // Storage already had data, so initialData should not overwrite
        expect(store.value).toEqual({ name: 'existing' });
    });

    it('should seed initialData into empty storage', () => {
        const storage = createMemoryStorage<{ name: string }>();

        const store = createStore({ storage, initialData: { name: 'seeded' } });

        expect(store.value).toEqual({ name: 'seeded' });
    });

    it('should fall back to memory storage when adapter reports unsupported', () => {
        const unsupported = {
            get: () => null,
            set: vi.fn(),
            clear: vi.fn(),
            isSupported: () => false,
        };

        const store = createStore({ storage: unsupported, initialData: { x: 1 } });

        // Should work fine with fallback memory storage
        expect(store.value).toEqual({ x: 1 });
        // The unsupported adapter's set should not have been called
        expect(unsupported.set).not.toHaveBeenCalled();
    });

    it('should catch and log subscriber errors without breaking other subscribers', () => {
        const logger = createDummyLogger();
        const store = createStore({ initialData: { count: 0 }, logger });
        const badSubscriber = () => {
            throw new Error('boom');
        };
        const goodSubscriber = vi.fn();

        store.subscribe(badSubscriber);
        store.subscribe(goodSubscriber);

        store.set({ count: 1 });

        expect(logger.error).toHaveBeenCalled();
        expect(goodSubscriber).toHaveBeenCalledWith({ count: 1 });
    });

    it('should support hydrate when storage has hydrate method', () => {
        let hydrated = false;
        const storage = {
            ...createMemoryStorage<{ count: number }>(),
            hydrate: () => {
                hydrated = true;
                return true;
            },
        };

        const store = createStore({ storage });
        const subscriber = vi.fn();
        store.subscribe(subscriber);

        store.hydrate();

        expect(hydrated).toBe(true);
        expect(subscriber).toHaveBeenCalled();
    });

    it('should not notify on hydrate when storage returns false', () => {
        const storage = {
            ...createMemoryStorage<{ count: number }>(),
            hydrate: () => false,
        };

        const store = createStore({ storage });
        const subscriber = vi.fn();
        store.subscribe(subscriber);

        store.hydrate();

        expect(subscriber).not.toHaveBeenCalled();
    });

    it('should log and recover from hydration errors', () => {
        const logger = createDummyLogger();
        const storage = {
            ...createMemoryStorage<{ count: number }>(),
            hydrate: () => {
                throw new Error('hydration failed');
            },
        };

        const store = createStore({ storage, logger });
        store.hydrate();

        expect(logger.error).toHaveBeenCalled();
    });

    it('should not eagerly emit on subscribe', () => {
        const store = createStore({ initialData: { count: 0 } });
        const listener = vi.fn();
        store.subscribe(listener);
        expect(listener).not.toHaveBeenCalled();
    });

    it('should support subscribeReact for useSyncExternalStore', () => {
        const store = createStore({ initialData: { count: 0 } });
        const listener = vi.fn();

        const unsub = store.subscribeReact(listener);
        store.set({ count: 1 });

        expect(listener).toHaveBeenCalled();

        unsub();
        store.set({ count: 2 });

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should return current value via getSnapshot', () => {
        const store = createStore({ initialData: { count: 5 } });
        expect(store.getSnapshot()).toEqual({ count: 5 });

        store.set({ count: 10 });
        expect(store.getSnapshot()).toEqual({ count: 10 });
    });
});
