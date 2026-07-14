import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DOC_PREFIX_ROOT } from '../../../models/CrdtDocumentTypes';
import { hasCrdtDocsInIdb } from '../hasCrdtDocsInIdb';
import { openDatabase } from '../helpers';

type MockRequest = {
    result: IDBValidKey | number | undefined;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
};

type MockStore = {
    count: ReturnType<typeof vi.fn>;
    getKey: ReturnType<typeof vi.fn>;
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
    let mockTransaction: { objectStore: ReturnType<typeof vi.fn> };
    let mockDatabase: IDBDatabase;

    beforeEach(() => {
        vi.clearAllMocks();

        mockStore = {
            count: vi.fn(),
            getKey: vi.fn(),
        };
        mockTransaction = {
            objectStore: vi.fn().mockReturnValue(mockStore),
        };
        mockDatabase = {
            transaction: vi.fn().mockReturnValue(mockTransaction),
        } as IDBDatabase;
        vi.mocked(openDatabase).mockResolvedValue(mockDatabase);
    });

    function settle(request: MockRequest): void {
        request.onsuccess?.();
    }

    it('returns false when IndexedDB contains only incremental chunks', async () => {
        const countRequest: MockRequest = { result: 1, onsuccess: null, onerror: null };
        const keyRequest: MockRequest = { result: undefined, onsuccess: null, onerror: null };
        mockStore.count.mockReturnValue(countRequest);
        mockStore.getKey.mockReturnValue(keyRequest);

        const resultPromise = hasCrdtDocsInIdb();
        await Promise.resolve();
        settle(countRequest);
        settle(keyRequest);

        await expect(resultPromise).resolves.toBe(false);
        expect(mockStore.getKey).toHaveBeenCalledWith(DOC_PREFIX_ROOT);
        expect(mockStore.count).not.toHaveBeenCalled();
    });

    it('returns true when the root base and child documents are persisted', async () => {
        const keyRequest: MockRequest = { result: DOC_PREFIX_ROOT, onsuccess: null, onerror: null };
        mockStore.getKey.mockReturnValue(keyRequest);

        const resultPromise = hasCrdtDocsInIdb();
        await Promise.resolve();
        settle(keyRequest);

        await expect(resultPromise).resolves.toBe(true);
        expect(mockStore.getKey).toHaveBeenCalledWith(DOC_PREFIX_ROOT);
        expect(mockStore.count).not.toHaveBeenCalled();
    });

    it('does not treat a child base document as a persisted project', async () => {
        const keyRequest: MockRequest = { result: undefined, onsuccess: null, onerror: null };
        mockStore.getKey.mockReturnValue(keyRequest);

        const resultPromise = hasCrdtDocsInIdb();
        await Promise.resolve();
        settle(keyRequest);

        await expect(resultPromise).resolves.toBe(false);
        expect(mockStore.getKey).toHaveBeenCalledWith(DOC_PREFIX_ROOT);
        expect(mockStore.count).not.toHaveBeenCalled();
    });

    it('returns false when IndexedDB is unavailable', async () => {
        vi.mocked(openDatabase).mockResolvedValue(null);

        await expect(hasCrdtDocsInIdb()).resolves.toBe(false);
        expect(mockDatabase.transaction).not.toHaveBeenCalled();
    });
});
