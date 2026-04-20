import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearCrdtIdb } from '../clearCrdtIdb';
import { openDatabase } from '../helpers';
import { loadAllFromIdb } from '../loadAllFromIdb';
import { saveAllToIdb } from '../saveAllToIdb';

vi.mock('../helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: vi.fn(),
}));

describe('crdtPersistence repository', () => {
    let mockTx: any;
    let mockStore: any;
    let mockDb: any;
    let mockRequest: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockRequest = {
            onsuccess: null,
            onerror: null,
            result: null,
        };

        mockStore = {
            getAllKeys: vi.fn(),
            getAll: vi.fn(),
            clear: vi.fn().mockReturnValue(mockRequest),
            put: vi.fn().mockReturnValue(mockRequest),
        };

        mockTx = {
            objectStore: vi.fn().mockReturnValue(mockStore),
            oncomplete: null,
            onerror: null,
            error: new Error('tx error'),
        };

        mockDb = {
            transaction: vi.fn().mockReturnValue(mockTx),
            close: vi.fn(),
        };
    });

    describe('loadAllFromIdb', () => {
        it('should return null if DB fails to open', async () => {
            vi.mocked(openDatabase).mockResolvedValue(null);
            const result = await loadAllFromIdb();
            expect(result).toBeNull();
        });

        it('should return null if no keys found', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);
            const keysReq = { result: [] };
            const valsReq = { result: [] };
            mockStore.getAllKeys.mockReturnValue(keysReq);
            mockStore.getAll.mockReturnValue(valsReq);

            const promise = loadAllFromIdb();
            await Promise.resolve(); // wait for openDatabase to resolve
            mockTx.oncomplete(); // Trigger completion
            const result = await promise;

            expect(result).toBeNull();
        });

        it('should load and map documents to a bundle', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);
            const keysReq = { result: ['doc1', 'doc2'] };
            const valsReq = { result: [new Uint8Array([1]), new Uint8Array([2])] };
            mockStore.getAllKeys.mockReturnValue(keysReq);
            mockStore.getAll.mockReturnValue(valsReq);

            const promise = loadAllFromIdb();
            await Promise.resolve();
            mockTx.oncomplete(); // Trigger completion
            const result = await promise;

            expect(result).toBeInstanceOf(Map);
            expect(result?.get('doc1')).toEqual(new Uint8Array([1]));
            expect(result?.get('doc2')).toEqual(new Uint8Array([2]));
        });
    });

    describe('saveAllToIdb', () => {
        it('should return early if DB fails to open', async () => {
            vi.mocked(openDatabase).mockResolvedValue(null);
            await saveAllToIdb(new Map());
            expect(mockDb.transaction).not.toHaveBeenCalled();
        });

        it('should clear store and put all documents', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);
            const bundle = new Map([
                ['doc1', new Uint8Array([1])],
                ['doc2', new Uint8Array([2])],
            ]);

            const promise = saveAllToIdb(bundle);
            await Promise.resolve();
            mockTx.oncomplete(); // Trigger completion
            await promise;

            expect(mockStore.clear).toHaveBeenCalled();
            expect(mockStore.put).toHaveBeenCalledWith(new Uint8Array([1]), 'doc1');
            expect(mockStore.put).toHaveBeenCalledWith(new Uint8Array([2]), 'doc2');
        });
    });

    describe('clearCrdtIdb', () => {
        it('should clear the store', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);

            const promise = clearCrdtIdb();
            await Promise.resolve();
            mockRequest.onsuccess(); // Trigger clear success
            await promise;

            expect(mockStore.clear).toHaveBeenCalled();
        });
    });
});
