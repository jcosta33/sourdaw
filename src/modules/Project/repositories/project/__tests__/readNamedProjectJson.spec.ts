import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function installFakeIndexedDb(): Map<string, string> {
    const values = new Map<string, string>();

    function makeRequest<T>(run: () => T) {
        const request: {
            result: T | undefined;
            error: unknown;
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
        } = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
            request.result = run();
            request.onsuccess?.();
        });
        return request;
    }

    const objectStore = {
        get: (key: string) => makeRequest(() => values.get(key) ?? null),
        put: (value: string, key: string) =>
            makeRequest(() => {
                values.set(key, value);
                return undefined;
            }),
        delete: (key: string) =>
            makeRequest(() => {
                values.delete(key);
                return undefined;
            }),
    };
    const database = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => objectStore,
        transaction: () => ({ objectStore: () => objectStore }),
    };
    const indexedDb = {
        open: () => {
            const request: {
                result: typeof database;
                error: unknown;
                onsuccess: (() => void) | null;
                onerror: (() => void) | null;
                onupgradeneeded: (() => void) | null;
            } = {
                result: database,
                error: null,
                onsuccess: null,
                onerror: null,
                onupgradeneeded: null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        },
    };

    vi.stubGlobal('indexedDB', indexedDb);
    return values;
}

describe('readNamedProjectJson', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('prefers the named project in localStorage', async () => {
        const key = 'sourdaw:project:1700000000000';
        const json = JSON.stringify({ version: 1, name: 'Small' });
        localStorage.setItem(key, json);
        const { readNamedProjectJson } = await import('../readNamedProjectJson');

        await expect(readNamedProjectJson(key)).resolves.toBe(json);
    });

    it('falls back to IndexedDB when localStorage has no copy', async () => {
        const values = installFakeIndexedDb();
        const key = 'sourdaw:project:1700000000000';
        const json = JSON.stringify({ version: 1, name: 'Large' });
        values.set(key, json);
        const { readNamedProjectJson } = await import('../readNamedProjectJson');

        await expect(readNamedProjectJson(key)).resolves.toBe(json);
    });
});
