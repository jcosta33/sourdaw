import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Minimal in-memory IndexedDB fake covering exactly the surface
 * storageOperations uses: open (+ onupgradeneeded), a readonly/readwrite
 * transaction, and objectStore.get/put/delete. Keyed by store name so a single
 * fake backs the whole module under test.
 */
function installFakeIndexedDb(): Map<string, string> {
    const store = new Map<string, string>();

    function makeRequest<T>(run: () => T) {
        const req: {
            result: T | undefined;
            error: unknown;
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
        } = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
            req.result = run();
            req.onsuccess?.();
        });
        return req;
    }

    const objectStore = {
        get: (key: string) => makeRequest(() => store.get(key) ?? null),
        put: (value: string, key: string) =>
            makeRequest(() => {
                store.set(key, value);
                return undefined;
            }),
        delete: (key: string) =>
            makeRequest(() => {
                store.delete(key);
                return undefined;
            }),
    };

    const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => objectStore,
        transaction: () => ({ objectStore: () => objectStore }),
    };

    const indexedDB = {
        open: () => {
            const req: {
                result: typeof db;
                error: unknown;
                onsuccess: (() => void) | null;
                onerror: (() => void) | null;
                onupgradeneeded: (() => void) | null;
            } = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
            queueMicrotask(() => req.onsuccess?.());
            return req;
        },
    };

    vi.stubGlobal('indexedDB', indexedDB);
    return store;
}

describe('storageOperations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('should write and read from cache and localStorage', async () => {
        const { writeProjectJson, readProjectJson } = await import('../storageOperations');
        const json = JSON.stringify({ name: 'Test' });
        writeProjectJson(json);

        expect(readProjectJson()).toBe(json);
        expect(localStorage.getItem('sourdaw-project')).toBe(json);
    });

    it('should remove project from cache and localStorage', async () => {
        const { writeProjectJson, removeProjectJson, readProjectJson } = await import('../storageOperations');
        writeProjectJson('{}');
        removeProjectJson();

        expect(readProjectJson()).toBeNull();
        expect(localStorage.getItem('sourdaw-project')).toBeNull();
    });

    it('should fallback to legacy localStorage if cache is empty', async () => {
        const { removeProjectJson, readProjectJson } = await import('../storageOperations');
        const json = JSON.stringify({ name: 'Legacy' });

        removeProjectJson();
        localStorage.setItem('sourdaw-project', json);

        expect(readProjectJson()).toBe(json);
    });

    it('should read a named project from localStorage when present', async () => {
        const { writeNamedProjectJson, readNamedProjectJson } = await import('../storageOperations');
        const json = JSON.stringify({ version: 1, name: 'Small' });
        writeNamedProjectJson('Small', json);

        await expect(readNamedProjectJson('sourdaw:project:Small')).resolves.toBe(json);
    });

    it('should fall back to IndexedDB when a named project is missing from localStorage', async () => {
        // Simulate a large project whose localStorage dual-write was dropped on
        // quota: the value lands in IndexedDB only. The reader must still find it.
        const fakeStore = installFakeIndexedDb();
        const { readNamedProjectJson } = await import('../storageOperations');

        const key = 'sourdaw:project:Large';
        const json = JSON.stringify({ version: 1, name: 'Large' });
        fakeStore.set(key, json);
        expect(localStorage.getItem(key)).toBeNull();

        await expect(readNamedProjectJson(key)).resolves.toBe(json);
    });
});
