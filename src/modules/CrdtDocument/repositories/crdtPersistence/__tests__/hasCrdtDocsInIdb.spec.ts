import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DOC_PREFIX_ROOT } from '../../../models/CrdtDocumentTypes';
import { hasCrdtDocsInIdb } from '../hasCrdtDocsInIdb';
import { openDatabase } from '../helpers';

type MockRequest = {
    result: IDBValidKey | undefined;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
};

type MockStore = {
    getKey: ReturnType<typeof vi.fn>;
};

type MockTransaction = {
    objectStore: ReturnType<typeof vi.fn>;
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
};

const mocks = vi.hoisted(() => ({
    openDatabase: vi.fn(),
}));

vi.mock('../helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: mocks.openDatabase,
}));

describe('hasCrdtDocsInIdb', () => {
    let mockStore: MockStore;
    let mockTransaction: MockTransaction;
    let mockDatabase: IDBDatabase;

    beforeEach(() => {
        vi.clearAllMocks();

        mockStore = {
            getKey: vi.fn(),
        };
        mockTransaction = {
            objectStore: vi.fn().mockReturnValue(mockStore),
            oncomplete: null,
            onerror: null,
            onabort: null,
        };
        mockDatabase = {
            transaction: vi.fn().mockReturnValue(mockTransaction),
        } as IDBDatabase;
        vi.mocked(openDatabase).mockResolvedValue(mockDatabase);
    });

    function settle(request: MockRequest): void {
        request.onsuccess?.();
        mockTransaction.oncomplete?.();
    }

    it('returns false when IndexedDB contains only incremental chunks', async () => {
        const keyRequest: MockRequest = { result: undefined, onsuccess: null, onerror: null };
        mockStore.getKey.mockReturnValue(keyRequest);

        const resultPromise = hasCrdtDocsInIdb();
        await vi.waitFor(() => expect(keyRequest.onsuccess).toBeTypeOf('function'));
        settle(keyRequest);

        await expect(resultPromise).resolves.toBe(false);
        expect(mockStore.getKey).toHaveBeenCalledWith(DOC_PREFIX_ROOT);
    });

    it('returns true when the root document is persisted', async () => {
        const keyRequest: MockRequest = { result: DOC_PREFIX_ROOT, onsuccess: null, onerror: null };
        mockStore.getKey.mockReturnValue(keyRequest);

        const resultPromise = hasCrdtDocsInIdb();
        await vi.waitFor(() => expect(keyRequest.onsuccess).toBeTypeOf('function'));
        settle(keyRequest);

        await expect(resultPromise).resolves.toBe(true);
        expect(mockStore.getKey).toHaveBeenCalledWith(DOC_PREFIX_ROOT);
    });

    it('does not treat a child base document as a persisted project', async () => {
        const keyRequest: MockRequest = { result: undefined, onsuccess: null, onerror: null };
        mockStore.getKey.mockReturnValue(keyRequest);

        const resultPromise = hasCrdtDocsInIdb();
        await vi.waitFor(() => expect(keyRequest.onsuccess).toBeTypeOf('function'));
        settle(keyRequest);

        await expect(resultPromise).resolves.toBe(false);
        expect(mockStore.getKey).toHaveBeenCalledWith(DOC_PREFIX_ROOT);
    });

    it('returns false when IndexedDB is unavailable', async () => {
        vi.mocked(openDatabase).mockResolvedValue(null);

        await expect(hasCrdtDocsInIdb()).resolves.toBe(false);
        expect(mockDatabase.transaction).not.toHaveBeenCalled();
    });

    it('rejects when the read transaction aborts before completion', async () => {
        const keyRequest: MockRequest = { result: DOC_PREFIX_ROOT, onsuccess: null, onerror: null };
        mockStore.getKey.mockReturnValue(keyRequest);

        const resultPromise = hasCrdtDocsInIdb();
        await vi.waitFor(() => expect(keyRequest.onsuccess).toBeTypeOf('function'));

        mockTransaction.onabort?.();

        await expect(resultPromise).rejects.toThrow('IDB transaction aborted');
    });
});
