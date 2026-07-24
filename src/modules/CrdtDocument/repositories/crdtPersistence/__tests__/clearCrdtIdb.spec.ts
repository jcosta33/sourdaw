import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearCrdtIdb } from '../clearCrdtIdb';
import { openDatabase } from '../helpers';

vi.mock('../helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: vi.fn(),
}));

describe('clearCrdtIdb', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolves without opening a transaction when IndexedDB is unavailable', async () => {
        vi.mocked(openDatabase).mockResolvedValue(null);

        // Persistence is optional; clearing a non-existent store must not throw.
        await expect(clearCrdtIdb()).resolves.toBeUndefined();
    });

    it('clears the object store and resolves on success', async () => {
        const clearRequest = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
        const store = { clear: vi.fn(() => clearRequest) };
        const tx = { objectStore: vi.fn(() => store) };
        const db = { transaction: vi.fn(() => tx) };
        vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

        const promise = clearCrdtIdb();
        await Promise.resolve();
        clearRequest.onsuccess?.();
        await promise;

        expect(db.transaction).toHaveBeenCalledWith('documents', 'readwrite');
        expect(store.clear).toHaveBeenCalledOnce();
    });

    it('rejects with the underlying error when the clear request fails', async () => {
        const failure = new Error('IDB clear denied');
        const clearRequest = {
            onsuccess: null as (() => void) | null,
            onerror: null as (() => void) | null,
            error: failure,
        };
        const store = { clear: vi.fn(() => clearRequest) };
        const tx = { objectStore: vi.fn(() => store) };
        const db = { transaction: vi.fn(() => tx) };
        vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

        const promise = clearCrdtIdb();
        await Promise.resolve();
        clearRequest.onerror?.();

        await expect(promise).rejects.toBe(failure);
    });

    it('rejects with a fallback message when the clear request errors without a cause', async () => {
        const clearRequest = {
            onsuccess: null as (() => void) | null,
            onerror: null as (() => void) | null,
            error: null,
        };
        const store = { clear: vi.fn(() => clearRequest) };
        const tx = { objectStore: vi.fn(() => store) };
        const db = { transaction: vi.fn(() => tx) };
        vi.mocked(openDatabase).mockResolvedValue(db as unknown as IDBDatabase);

        const promise = clearCrdtIdb();
        await Promise.resolve();
        clearRequest.onerror?.();

        await expect(promise).rejects.toThrow('IDB request failed');
    });
});
