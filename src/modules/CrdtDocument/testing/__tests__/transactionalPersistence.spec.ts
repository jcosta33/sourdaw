import { describe, expect, it } from 'vitest';

import { TransactionalPersistence } from '../transactionalPersistence';

describe('TransactionalPersistence', () => {
    it('exposes a database object with a transaction method', () => {
        const persistence = new TransactionalPersistence();
        expect(persistence.database).toBeDefined();
        expect(typeof persistence.database.transaction).toBe('function');
    });

    it('seed and readKeys/readValues round-trip', () => {
        const persistence = new TransactionalPersistence();
        persistence.seed('key-a', new Uint8Array([1, 2, 3]));
        persistence.seed('key-b', new Uint8Array([4, 5]));
        expect(persistence.readKeys()).toEqual(['key-a', 'key-b']);
        expect(persistence.readValues()).toHaveLength(2);
        expect(persistence.readValues()[0]).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('returns all transactions via getTransactions()', () => {
        const persistence = new TransactionalPersistence();
        persistence.database.transaction('store', 'readonly');
        persistence.database.transaction('store', 'readwrite');
        expect(persistence.getTransactions()).toHaveLength(2);
        expect(persistence.getTransactions('readonly')).toHaveLength(1);
        expect(persistence.getTransactions('readwrite')).toHaveLength(1);
    });

    it('waitForTransaction resolves for an already-created transaction', async () => {
        const persistence = new TransactionalPersistence();
        persistence.database.transaction('store', 'readonly');
        const tx = await persistence.waitForTransaction('readonly', 1);
        expect(tx).toBeDefined();
        expect(tx.mode).toBe('readonly');
    });

    it('creates a transaction with readonly mode by default', () => {
        const persistence = new TransactionalPersistence();
        persistence.database.transaction('store');
        expect(persistence.getTransactions()[0]?.mode).toBe('readonly');
    });
});

describe('TransactionalPersistence — transaction lifecycle', () => {
    it('readonly transactions start immediately via createTransaction', () => {
        const persistence = new TransactionalPersistence();
        const tx = persistence.database.transaction('store', 'readonly');
        expect(tx.mode).toBe('readonly');
    });

    it('settleComplete fires oncomplete callback', () => {
        const persistence = new TransactionalPersistence();
        const tx = persistence.database.transaction('store', 'readonly');
        let completed = false;
        tx.oncomplete = () => {
            completed = true;
        };
        tx.settleComplete();
        expect(completed).toBe(true);
    });

    it('settleComplete is idempotent (second call does nothing)', () => {
        const persistence = new TransactionalPersistence();
        const tx = persistence.database.transaction('store', 'readonly');
        let count = 0;
        tx.oncomplete = () => {
            count++;
        };
        tx.settleComplete();
        tx.settleComplete();
        expect(count).toBe(1);
    });

    it('settleError fires onerror and onabort', () => {
        const persistence = new TransactionalPersistence();
        const tx = persistence.database.transaction('store', 'readonly');
        let errorFired = false;
        let abortFired = false;
        tx.onerror = () => {
            errorFired = true;
        };
        tx.onabort = () => {
            abortFired = true;
        };
        const error = new DOMException('test', 'UnknownError');
        tx.settleError(error);
        expect(errorFired).toBe(true);
        expect(abortFired).toBe(true);
        expect(tx.error).toBe(error);
    });

    it('settleAbort fires onabort', () => {
        const persistence = new TransactionalPersistence();
        const tx = persistence.database.transaction('store', 'readonly');
        let abortFired = false;
        tx.onabort = () => {
            abortFired = true;
        };
        tx.settleAbort();
        expect(abortFired).toBe(true);
    });

    it('writes array records put and add operations', () => {
        const persistence = new TransactionalPersistence();
        const tx = persistence.database.transaction('store', 'readwrite');
        const store = tx.objectStore();
        store.put(new Uint8Array([1]), 'key1');
        store.add(new Uint8Array([2]), 'key2');
        expect(tx.writes).toHaveLength(2);
        expect(tx.writes[0]?.kind).toBe('put');
        expect(tx.writes[1]?.kind).toBe('add');
    });

    it('apply executes operations against a records map', () => {
        const persistence = new TransactionalPersistence();
        const tx = persistence.database.transaction('store', 'readwrite');
        const store = tx.objectStore();
        store.put(new Uint8Array([42]), 'key1');
        const records = new Map<string, Uint8Array>();
        tx.apply(records);
        expect(records.get('key1')).toEqual(new Uint8Array([42]));
    });

    it('clear operation empties the records map', () => {
        const persistence = new TransactionalPersistence();
        const tx = persistence.database.transaction('store', 'readwrite');
        const store = tx.objectStore();
        store.clear();
        const records = new Map<string, Uint8Array>([['key1', new Uint8Array([1])]]);
        tx.apply(records);
        expect(records.size).toBe(0);
    });

    it('getAllKeys and getAll return seeded records', () => {
        const persistence = new TransactionalPersistence();
        persistence.seed('key-a', new Uint8Array([1]));
        persistence.seed('key-b', new Uint8Array([2]));
        const tx = persistence.database.transaction('store', 'readonly');
        const store = tx.objectStore();
        tx.start();
        const keysReq = store.getAllKeys();
        const valuesReq = store.getAll();
        expect(keysReq.result).toEqual(['key-a', 'key-b']);
        expect(valuesReq.result).toHaveLength(2);
    });
});
