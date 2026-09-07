import { describe, expect, it } from 'vitest';

import { installTransactionalIndexedDb } from '../installTransactionalIndexedDb';

function waitForRequest<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')));
    });
}

function waitForTransaction(transaction: IDBTransaction): Promise<'abort' | 'complete'> {
    return new Promise((resolve) => {
        transaction.addEventListener('complete', () => resolve('complete'));
        transaction.addEventListener('abort', () => resolve('abort'));
    });
}

function isUint8Array(value: unknown): value is Uint8Array {
    return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function openDatabase(name = 'fixture', version = 1): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB open failed')));
        request.addEventListener('upgradeneeded', () => {
            if (!request.result.objectStoreNames.contains('documents')) {
                request.result.createObjectStore('documents');
            }
        });
        request.addEventListener('success', () => resolve(request.result));
    });
}

async function readDocument(database: IDBDatabase, key: string): Promise<Uint8Array | undefined> {
    const transaction = database.transaction('documents');
    const result: unknown = await waitForRequest(transaction.objectStore('documents').get(key));
    await waitForTransaction(transaction);
    if (result === undefined || isUint8Array(result)) {
        return result;
    }
    throw new TypeError('Expected IndexedDB to return Uint8Array bytes');
}

async function writeDocument(database: IDBDatabase, key: string, value: Uint8Array): Promise<void> {
    const transaction = database.transaction('documents', 'readwrite');
    transaction.objectStore('documents').put(value, key);
    await waitForTransaction(transaction);
}

describe('installTransactionalIndexedDb', () => {
    it('runs genuine IndexedDB transactions and clones stored bytes', async () => {
        const installation = installTransactionalIndexedDb();
        try {
            const database = await openDatabase();
            const original = new Uint8Array([1, 2, 3]);
            const transaction = database.transaction('documents', 'readwrite');
            transaction.objectStore('documents').put(original, 'root');
            original[0] = 9;

            await expect(waitForTransaction(transaction)).resolves.toBe('complete');
            const stored = await readDocument(database, 'root');
            expect(Object.prototype.toString.call(stored)).toBe('[object Uint8Array]');
            expect(stored ? Array.from(stored) : stored).toEqual([1, 2, 3]);
        } finally {
            await installation.dispose();
        }
    });

    it('waits for a default write to settle before disposal completes', async () => {
        const installation = installTransactionalIndexedDb();
        const database = await openDatabase();
        const events: string[] = [];
        const transaction = database.transaction('documents', 'readwrite');
        transaction.addEventListener('complete', () => events.push('complete'));
        transaction.objectStore('documents').put(new Uint8Array([4]), 'root');

        const disposal = installation.dispose().then(() => events.push('disposed'));
        await disposal;

        expect(events).toEqual(['complete', 'disposed']);
        expect(() => database.transaction('documents')).toThrowError(DOMException);
    });

    it('waits for a write admitted by versionchange before close-pending deletion completes', async () => {
        const installation = installTransactionalIndexedDb();
        const database = await openDatabase();
        const events: string[] = [];
        database.addEventListener('versionchange', () => {
            const transaction = database.transaction('documents', 'readwrite');
            transaction.addEventListener('complete', () => events.push('complete'));
            transaction.objectStore('documents').put(new Uint8Array([7]), 'root');
            database.close();
        });

        await installation.dispose().then(() => events.push('disposed'));

        expect(events).toEqual(['complete', 'disposed']);
    });

    it('waits for an aborted transaction before disposal completes', async () => {
        const installation = installTransactionalIndexedDb();
        const database = await openDatabase();
        const events: string[] = [];
        const transaction = database.transaction('documents', 'readwrite');
        transaction.addEventListener('abort', () => events.push('abort'));
        transaction.objectStore('documents').put(new Uint8Array([5]), 'root');
        transaction.abort();

        const disposal = installation.dispose().then(() => events.push('disposed'));
        await disposal;

        expect(events).toEqual(['abort', 'disposed']);
    });

    it('settles an open when disposal starts before its upgrade', async () => {
        const installation = installTransactionalIndexedDb();
        const request = indexedDB.open('pending-before-upgrade', 2);
        request.addEventListener('upgradeneeded', () => request.result.createObjectStore('documents'));
        const opened = waitForRequest(request);

        const firstDisposal = installation.dispose();
        expect(installation.dispose()).toBe(firstDisposal);
        const database = await opened;
        await firstDisposal;

        expect(database.objectStoreNames.contains('documents')).toBe(true);
        expect(() => database.transaction('documents')).toThrowError(DOMException);
    });

    it('settles an open when disposal starts inside its upgrade', async () => {
        const installation = installTransactionalIndexedDb();
        const request = indexedDB.open('pending-inside-upgrade', 2);
        const lifecycle: { disposal: Promise<void> | null } = { disposal: null };
        request.addEventListener('upgradeneeded', () => {
            request.result.createObjectStore('documents');
            lifecycle.disposal = installation.dispose();
        });

        const database = await waitForRequest(request);
        if (!lifecycle.disposal) {
            throw new Error('Expected disposal to start during upgrade');
        }
        await lifecycle.disposal;

        expect(database.objectStoreNames.contains('documents')).toBe(true);
        expect(() => database.transaction('documents')).toThrowError(DOMException);
    });

    it('releases a genuinely blocked upgrade only after its blocker receives versionchange', async () => {
        const installation = installTransactionalIndexedDb();
        const firstDatabase = await openDatabase('blocked-fixture');
        const events: string[] = [];
        firstDatabase.addEventListener('versionchange', () => events.push('versionchange'));

        const request = indexedDB.open('blocked-fixture', 2);
        request.addEventListener('blocked', () => events.push('blocked'));
        request.addEventListener('upgradeneeded', () => events.push('upgrade'));
        const opened = waitForRequest(request);

        const disposal = installation.dispose();
        await opened;
        await disposal;

        expect(events).toEqual(['versionchange', 'blocked', 'upgrade']);
        expect(() => firstDatabase.transaction('documents')).toThrowError(DOMException);
    });

    it('fences a retained factory while a successor starts empty', async () => {
        const first = installTransactionalIndexedDb();
        const retainedFactory = indexedDB;
        const firstDatabase = await openDatabase();
        await writeDocument(firstDatabase, 'root', new Uint8Array([6]));
        await first.dispose();

        expect(() => retainedFactory.open('fixture')).toThrow('Transactional IndexedDB installation is closing');

        const second = installTransactionalIndexedDb();
        try {
            const secondDatabase = await openDatabase();
            await expect(readDocument(secondDatabase, 'root')).resolves.toBeUndefined();
        } finally {
            await second.dispose();
        }
    });

    it('refuses overlapping installations', async () => {
        const installation = installTransactionalIndexedDb();
        try {
            expect(() => installTransactionalIndexedDb()).toThrow(
                'A transactional IndexedDB installation is already active'
            );
        } finally {
            await installation.dispose();
        }
    });

    it('restores the exact original global descriptor', async () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        const originalFactory = { original: true };
        const expectedDescriptor: PropertyDescriptor = {
            configurable: true,
            enumerable: true,
            value: originalFactory,
            writable: false,
        };
        Object.defineProperty(globalThis, 'indexedDB', expectedDescriptor);

        try {
            const installation = installTransactionalIndexedDb();
            await installation.dispose();
            expect(Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')).toEqual(expectedDescriptor);
        } finally {
            if (originalDescriptor) {
                Object.defineProperty(globalThis, 'indexedDB', originalDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, 'indexedDB');
            }
        }
    });

    it('restores the absence of an original global', async () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        Reflect.deleteProperty(globalThis, 'indexedDB');

        try {
            const installation = installTransactionalIndexedDb();
            await installation.dispose();
            expect(Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')).toBeUndefined();
        } finally {
            if (originalDescriptor) {
                Object.defineProperty(globalThis, 'indexedDB', originalDescriptor);
            }
        }
    });

    it('preserves a foreign replacement global during disposal', async () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        const installation = installTransactionalIndexedDb();
        const foreignFactory = { foreign: true };
        Object.defineProperty(globalThis, 'indexedDB', {
            configurable: true,
            value: foreignFactory,
            writable: true,
        });

        try {
            await installation.dispose();
            expect(Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')?.value).toBe(foreignFactory);
        } finally {
            if (originalDescriptor) {
                Object.defineProperty(globalThis, 'indexedDB', originalDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, 'indexedDB');
            }
        }
    });
});
