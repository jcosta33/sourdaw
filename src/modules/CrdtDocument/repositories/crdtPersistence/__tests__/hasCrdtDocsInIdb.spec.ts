import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasCrdtDocsInIdb } from '../hasCrdtDocsInIdb';

type CountRequest = {
    result: number;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
};

type MockStore = {
    count: ReturnType<typeof vi.fn<() => CountRequest>>;
};

type MockTransaction = {
    objectStore: () => MockStore;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
    error: Error | null;
};

type MockDatabase = {
    transaction: ReturnType<typeof vi.fn<() => MockTransaction>>;
};

const mocks = vi.hoisted(() => ({
    openDatabase: vi.fn<() => Promise<MockDatabase | null>>(),
}));

vi.mock('../helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: mocks.openDatabase,
}));

describe('hasCrdtDocsInIdb', () => {
    let countRequest: CountRequest;
    let store: MockStore;
    let transaction: MockTransaction;
    let database: MockDatabase;

    beforeEach(() => {
        vi.clearAllMocks();

        countRequest = { result: 0, onsuccess: null, onerror: null };
        store = { count: vi.fn<() => CountRequest>(() => countRequest) };
        transaction = {
            objectStore: () => store,
            onerror: null,
            onabort: null,
            error: null,
        };
        database = { transaction: vi.fn(() => transaction) };
        mocks.openDatabase.mockResolvedValue(database);
    });

    it('returns false when IndexedDB is unavailable', async () => {
        mocks.openDatabase.mockResolvedValue(null);
        await expect(hasCrdtDocsInIdb()).resolves.toBe(false);
    });

    it('returns false when IndexedDB contains no persisted records', async () => {
        const promise = hasCrdtDocsInIdb();
        await Promise.resolve();
        countRequest.result = 0;
        countRequest.onsuccess?.();

        await expect(promise).resolves.toBe(false);
        expect(store.count).toHaveBeenCalledOnce();
    });

    it('observes non-empty persistence with a count only', async () => {
        const promise = hasCrdtDocsInIdb();
        await Promise.resolve();
        countRequest.result = 1;
        countRequest.onsuccess?.();

        await expect(promise).resolves.toBe(true);
        expect(database.transaction).toHaveBeenCalledWith('documents', 'readonly');
        expect(store.count).toHaveBeenCalledOnce();
    });

    it('does not read or decode the full bundle during presence inspection', async () => {
        const promise = hasCrdtDocsInIdb();
        await Promise.resolve();
        countRequest.result = 1;
        countRequest.onsuccess?.();

        await expect(promise).resolves.toBe(true);
        expect(database.transaction).toHaveBeenCalledTimes(1);
        expect(store.count).toHaveBeenCalledTimes(1);
    });
});
