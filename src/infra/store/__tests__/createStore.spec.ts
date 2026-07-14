import { describe, it, expect, vi } from 'vitest';

import { type Logger } from '#/infra/logger/types';

import { batchStoreUpdates, createStore } from '../createStore';
import { createMemoryStorage } from '../storage/createMemoryStorage';

const createDummyLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setWriters: vi.fn(),
});

type PreferencesState = {
    theme: 'dark' | 'light';
    autoSave: boolean;
};

const defaultPreferences = {
    theme: 'dark',
    autoSave: true,
} satisfies PreferencesState;

const isPreferencesState = (value: unknown): value is PreferencesState => {
    return (
        value !== null &&
        typeof value === 'object' &&
        'theme' in value &&
        'autoSave' in value &&
        (value.theme === 'dark' || value.theme === 'light') &&
        typeof value.autoSave === 'boolean'
    );
};

const sanitizePreferences = (value: unknown): PreferencesState => {
    if (isPreferencesState(value)) {
        return value;
    }

    return defaultPreferences;
};

describe('createStore', () => {
    it('should expose the store contract methods', () => {
        const store = createStore({ initialData: { count: 0 } });

        expect(typeof store.set).toBe('function');
        expect(typeof store.update).toBe('function');
        expect(typeof store.clear).toBe('function');
        expect(typeof store.hydrate).toBe('function');
        expect(typeof store.subscribe).toBe('function');
        expect(typeof store.subscribeReact).toBe('function');
        expect(typeof store.getSnapshot).toBe('function');
    });

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

    it('should defer and deduplicate notifications until a store batch is complete', () => {
        const first = createStore({ initialData: { count: 0 } });
        const second = createStore({ initialData: { count: 0 } });
        const observations: Array<[number, number]> = [];
        first.subscribe(() => observations.push([first.value!.count, second.value!.count]));
        second.subscribe(() => observations.push([first.value!.count, second.value!.count]));

        batchStoreUpdates(() => {
            first.set({ count: 1 });
            first.set({ count: 2 });
            second.set({ count: 3 });
            expect(observations).toEqual([]);
        });

        expect(observations).toEqual([
            [2, 3],
            [2, 3],
        ]);
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

    it('should sanitize a present non-null persisted blob before exposing value', () => {
        const storage = createMemoryStorage<unknown>();
        storage.set({ theme: null, autoSave: 'yes' });

        const store = createStore<unknown>({
            storage,
            initialData: defaultPreferences,
            sanitize: sanitizePreferences,
        });

        expect(store.value).toEqual(defaultPreferences);
        expect(storage.get()).toEqual(defaultPreferences);
    });

    it('should preserve valid persisted state when a sanitizer is configured', () => {
        const storage = createMemoryStorage<unknown>();
        const validPreferences = {
            theme: 'light',
            autoSave: false,
        } satisfies PreferencesState;
        storage.set(validPreferences);

        const store = createStore<unknown>({
            storage,
            initialData: defaultPreferences,
            sanitize: sanitizePreferences,
        });

        expect(store.value).toEqual(validPreferences);
        expect(storage.get()).toEqual(validPreferences);
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

    it('should return the same value reference until a write replaces it', () => {
        const store = createStore({ initialData: { count: 0 } });
        const firstSnapshot = store.value;
        const secondSnapshot = store.value;

        expect(firstSnapshot).toBe(secondSnapshot);

        store.set({ count: 1 });

        expect(store.value).not.toBe(firstSnapshot);
    });
});
